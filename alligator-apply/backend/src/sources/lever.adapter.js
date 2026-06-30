import { JobSourceAdapter, buildNormalizedJob } from './base.adapter.js';
import { validateBoardTokenTarget, resolveBoardToken } from './providers/providerContract.js';
import { filterJobs, loadMockJobs, paginateJobs, delay } from './utils.js';
import { legacyMockToJob } from './types.js';
import { fetchJson } from './httpClient.js';
import {
  fetchTargetsParallel,
  finalizeLiveSearch,
  isMockMode,
  mockDelay,
  requireTargets,
  stripHtml,
} from './liveSearch.js';
import { passesEarlyFilter } from './earlyFilter.js';
import { isFastScan } from './scanConfig.js';
import { reportTargetFetch, reportTargetFetchError } from '../services/scanDiagnostics.js';

const API_BASE = 'https://api.lever.co/v0/postings';

export class LeverAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'lever', atsType: 'lever', label: 'Lever', ...config });
  }

  metadata() {
    return {
      ...super.metadata(),
      label: 'Lever',
      targetLabel: 'Company slugs',
      careersUrlTemplate: 'https://jobs.lever.co/{boardToken}',
    };
  }

  validateTarget(target) {
    return validateBoardTokenTarget(target);
  }

  async healthCheck(target, options = {}) {
    const token = resolveBoardToken(target);
    const validation = this.validateTarget(token);
    if (!validation.valid) return { ok: false, error: validation.error };
    if (isMockMode()) return { ok: true, mode: 'mock' };

    const started = Date.now();
    try {
      const url = `${API_BASE}/${encodeURIComponent(token)}?mode=json`;
      const data = await fetchJson(url, {
        timeoutMs: options.timeoutMs ?? Math.min(this.timeoutMs, 8000),
      });
      const count = Array.isArray(data) ? data.length : 0;
      return { ok: true, latencyMs: Date.now() - started, sampleCount: count };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: err.message };
    }
  }

  async fetchJobs(filters = {}, options = {}) {
    const page = options.page || 1;
    const limit = Math.min(options.limit || this.maxResults, this.maxResults);

    if (isMockMode()) {
      await mockDelay();
      const pool = filterJobs(
        loadMockJobs().filter((j) => j.source === 'lever'),
        filters
      );
      const { jobs, total, hasMore } = paginateJobs(pool, page, limit);
      return {
        jobs,
        page,
        limit,
        total,
        hasMore,
        stats: { fetched: pool.length, afterFilters: pool.length },
      };
    }

    const companies = requireTargets('lever');
    const companyFilter = (filters.company || '').toLowerCase();
    const selected = companyFilter
      ? companies.filter((c) => c.toLowerCase().includes(companyFilter))
      : companies;

    if (selected.length === 0) {
      return finalizeLiveSearch([], filters, { page, limit }, { fetched: 0 });
    }

    const { items: rawJobs, errors } = await fetchTargetsParallel(
      'lever',
      selected,
      (company) => this.fetchCompanyJobs(company, filters),
      filters,
      { onCompanyDone: options.hooks?.onCompanyDone }
    );

    if (rawJobs.length === 0 && errors.length > 0) {
      throw new Error(errors.map((e) => `${e.target}: ${e.error}`).join('; '));
    }

    const normalized = rawJobs.map((raw) => this.normalize(raw.job, raw.company));
    return finalizeLiveSearch(normalized, filters, { page, limit }, { fetched: normalized.length });
  }

  /**
   * @param {string} companySlug
   * @param {import('./types.js').SearchFilters} filters
   */
  async fetchCompanyJobs(companySlug, filters) {
    const params = new URLSearchParams({ mode: 'json' });
    if (filters.location) params.set('location', filters.location);
    if (filters.employmentType) {
      const commitment = mapEmploymentToLever(filters.employmentType);
      if (commitment) params.set('commitment', commitment);
    }

    const url = `${API_BASE}/${encodeURIComponent(companySlug)}?${params}`;
    let httpStatus = null;
    try {
      const data = await fetchJson(url, {
        timeoutMs: this.timeoutMs,
        onHttpResponse: (r) => {
          httpStatus = r.status;
        },
      });
      if (!Array.isArray(data)) {
        throw new Error(data?.error || 'Unexpected Lever API response');
      }

      const rawFetched = data.length;
      const afterEarly = data.filter((job) =>
        passesEarlyFilter({ ...job, _companySlug: companySlug }, filters, 'lever')
      );
      const mapped = afterEarly.slice(0, this.maxResults).map((job) => ({
        company: companySlug,
        job: { ...job, _companySlug: companySlug },
      }));

      reportTargetFetch('lever', companySlug, {
        url,
        httpStatus: httpStatus ?? 200,
        rawFetched,
        afterEarlyFilter: afterEarly.length,
        normalized: mapped.length,
        sampleRawTitles: data.slice(0, 5).map((j) => j.text || j.title),
      });

      return mapped;
    } catch (err) {
      reportTargetFetchError('lever', companySlug, {
        url,
        httpStatus: err.httpStatus ?? httpStatus,
        httpBody: err.httpBody ?? null,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  normalize(rawJob, companySlug = '') {
    if (this.isUnifiedJob(rawJob)) return rawJob;
    if (this.isLegacyMock(rawJob)) {
      return legacyMockToJob({ ...rawJob, source: 'lever', atsType: 'lever' });
    }

    const slug = companySlug || rawJob._companySlug || '';
    const categories = rawJob.categories || {};
    const location = categories.location || rawJob.location || '';
    const description = isFastScan()
      ? ''
      : stripHtml(rawJob.descriptionPlain || rawJob.description || rawJob.additionalPlain || '');

    const job = buildNormalizedJob({
      source: 'lever',
      atsType: 'lever',
      company: rawJob.company || categories.team || titleCase(slug),
      title: rawJob.text || rawJob.title || '',
      location,
      workMode: inferWorkModeFromLever(categories),
      employmentType: mapLeverCommitment(categories.commitment),
      applyUrl: rawJob.applyUrl || rawJob.hostedUrl || '',
      description,
      postedDate: rawJob.createdAt || null,
      rawData: rawJob,
    });
    job.visaSignals = { fit: 'unknown', sponsorshipMentioned: false, cptMentioned: false };
    return job;
  }

  isUnifiedJob(job) {
    return Boolean(job?.source && job?.atsType && job?.visaSignals && job?.applyUrl !== undefined);
  }

  isLegacyMock(job) {
    return String(job?.id || '').startsWith('mock-');
  }
}

function inferWorkModeFromLever(categories) {
  const loc = (categories.location || '').toLowerCase();
  if (loc.includes('remote')) return 'remote';
  if (loc.includes('hybrid')) return 'hybrid';
  return loc.includes('onsite') || loc.includes('on-site') ? 'onsite' : '';
}

function mapLeverCommitment(c) {
  const v = (c || '').toLowerCase();
  if (v.includes('intern')) return 'internship';
  if (v.includes('contract')) return 'contract';
  if (v.includes('part')) return 'part_time';
  return 'full_time';
}

function mapEmploymentToLever(employmentType) {
  const map = {
    full_time: 'Full-time',
    part_time: 'Part-time',
    contract: 'Contract',
    internship: 'Internship',
  };
  return map[employmentType] || '';
}

function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
