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
import { reportTargetFetch, reportTargetFetchError } from '../services/scanDiagnostics.js';

const API_BASE = 'https://api.smartrecruiters.com/v1/companies';

export class SmartRecruitersAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({
      name: 'smartrecruiters',
      atsType: 'smartrecruiters',
      label: 'SmartRecruiters',
      ...config,
    });
  }

  metadata() {
    return {
      ...super.metadata(),
      label: 'SmartRecruiters',
      targetLabel: 'Company identifiers',
      careersUrlTemplate: 'https://careers.smartrecruiters.com/{boardToken}',
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
      const url = `${API_BASE}/${encodeURIComponent(token)}/postings?limit=1`;
      const data = await fetchJson(url, {
        timeoutMs: options.timeoutMs ?? Math.min(this.timeoutMs, 8000),
      });
      const count = Array.isArray(data?.content) ? data.content.length : 0;
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
        loadMockJobs().filter((j) => j.source === 'smartrecruiters'),
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

    const companies = requireTargets('smartrecruiters', { filters });
    const companyFilter = (filters.company || '').toLowerCase();
    const selected = companyFilter
      ? companies.filter((c) => c.toLowerCase().includes(companyFilter))
      : companies;

    if (selected.length === 0) {
      return finalizeLiveSearch([], filters, { page, limit }, { fetched: 0 });
    }

    const { items: rawJobs, errors } = await fetchTargetsParallel(
      'smartrecruiters',
      selected,
      (companyId) => this.fetchAllPostings(companyId, limit, filters),
      filters,
      { onCompanyDone: options.hooks?.onCompanyDone }
    );

    if (rawJobs.length === 0 && errors.length > 0) {
      throw new Error(errors.map((e) => `${e.target}: ${e.error}`).join('; '));
    }

    const normalized = rawJobs.map((raw) => this.normalize(raw.job, raw.companyId));
    return finalizeLiveSearch(normalized, filters, { page, limit }, { fetched: normalized.length });
  }

  /**
   * Paginate SmartRecruiters postings API until maxResults or no more pages.
   * @param {string} companyId
   * @param {number} maxResults
   * @param {import('./types.js').SearchFilters} filters
   */
  async fetchAllPostings(companyId, maxResults, filters = {}) {
    const pageSize = Math.min(100, maxResults);
    let offset = 0;
    let totalFound = Infinity;
    const collected = [];
    let httpStatus = null;
    let firstUrl = null;
    let rawFetchedTotal = 0;

    try {
      while (collected.length < maxResults && offset < totalFound) {
        const params = new URLSearchParams({
          offset: String(offset),
          limit: String(pageSize),
        });
        const url = `${API_BASE}/${encodeURIComponent(companyId)}/postings?${params}`;
        if (!firstUrl) firstUrl = url;
        const data = await fetchJson(url, {
          timeoutMs: this.timeoutMs,
          onHttpResponse: (r) => {
            httpStatus = r.status;
          },
        });

        totalFound = Number(data?.totalFound ?? 0);
        const content = Array.isArray(data?.content) ? data.content : [];
        rawFetchedTotal += content.length;
        if (content.length === 0) break;

        for (const job of content) {
          if (!passesEarlyFilter({ ...job, _companyId: companyId }, filters, 'smartrecruiters')) continue;
          collected.push({ companyId, job: { ...job, _companyId: companyId } });
          if (collected.length >= maxResults) break;
        }

        offset += content.length;
        if (content.length < pageSize) break;
      }

      reportTargetFetch('smartrecruiters', companyId, {
        url: firstUrl,
        httpStatus: httpStatus ?? 200,
        rawFetched: rawFetchedTotal,
        afterEarlyFilter: collected.length,
        normalized: collected.length,
        sampleRawTitles: collected.slice(0, 5).map((j) => j.job?.name || j.job?.title),
      });

      return collected;
    } catch (err) {
      reportTargetFetchError('smartrecruiters', companyId, {
        url: firstUrl,
        httpStatus: err.httpStatus ?? httpStatus,
        httpBody: err.httpBody ?? null,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  normalize(rawJob, companyId = '') {
    if (this.isUnifiedJob(rawJob)) return rawJob;
    if (this.isLegacyMock(rawJob)) {
      return legacyMockToJob({
        ...rawJob,
        source: 'smartrecruiters',
        atsType: 'smartrecruiters',
      });
    }

    const identifier = rawJob.company?.identifier || companyId || rawJob._companyId || '';
    const location =
      rawJob.location?.fullLocation ||
      [rawJob.location?.city, rawJob.location?.country].filter(Boolean).join(', ') ||
      '';

    const applyUrl =
      rawJob.applyUrl ||
      (identifier && rawJob.id
        ? `https://jobs.smartrecruiters.com/${identifier}/${rawJob.id}`
        : '');

    const description = '';

    const job = buildNormalizedJob({
      source: 'smartrecruiters',
      atsType: 'smartrecruiters',
      company: rawJob.company?.name || titleCase(identifier),
      title: rawJob.name || rawJob.title || '',
      location,
      workMode: inferWorkModeFromSr(rawJob),
      employmentType: mapSrType(rawJob.typeOfEmployment),
      applyUrl,
      description,
      postedDate: rawJob.releasedDate || null,
      rawData: rawJob,
    });
    job.visaSignals = { fit: 'unknown', sponsorshipMentioned: false, cptMentioned: false };
    job.experienceLevel = mapSrExperience(rawJob.experienceLevel);
    return job;
  }

  isUnifiedJob(job) {
    return Boolean(job?.source && job?.atsType && job?.visaSignals && job?.applyUrl !== undefined);
  }

  isLegacyMock(job) {
    return String(job?.id || '').startsWith('mock-');
  }
}

function inferWorkModeFromSr(raw) {
  if (raw.location?.remote) return 'remote';
  if (raw.location?.hybrid) return 'hybrid';
  const loc = JSON.stringify(raw.location || {}).toLowerCase();
  if (loc.includes('remote')) return 'remote';
  if (loc.includes('hybrid')) return 'hybrid';
  return '';
}

function mapSrType(t) {
  const v = (t?.label || t?.id || t || '').toLowerCase();
  if (v.includes('intern')) return 'internship';
  if (v.includes('contract')) return 'contract';
  if (v.includes('part')) return 'part_time';
  return 'full_time';
}

function mapSrExperience(level) {
  const v = (level?.id || level?.label || '').toLowerCase();
  if (v.includes('entry')) return 'entry';
  if (v.includes('mid')) return 'mid';
  if (v.includes('senior')) return 'senior';
  return '';
}

function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
