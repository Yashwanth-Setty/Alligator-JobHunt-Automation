import { JobSourceAdapter, buildNormalizedJob } from './base.adapter.js';
import { validateBoardTokenTarget, resolveBoardToken } from './providers/providerContract.js';
import { filterJobs, loadMockJobs, paginateJobs } from './utils.js';
import { legacyMockToJob } from './types.js';
import { fetchJson } from './httpClient.js';
import { passesEarlyFilter } from './earlyFilter.js';
import {
  fetchTargetsParallel,
  finalizeLiveSearch,
  isMockMode,
  mockDelay,
  requireTargets,
  stripHtml,
} from './liveSearch.js';
import { greenhouseFetchContent, isFastScan } from './scanConfig.js';
import { reportTargetFetch, reportTargetFetchError } from '../services/scanDiagnostics.js';
import {
  detectScanIntent,
  AI_PRIORITY_TOKENS,
} from '../services/companyRegistry/registryScanPlanner.js';

const API_BASE = 'https://boards-api.greenhouse.io/v1/boards';

export class GreenhouseAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'greenhouse', atsType: 'greenhouse', label: 'Greenhouse', ...config });
  }

  metadata() {
    return {
      ...super.metadata(),
      label: 'Greenhouse',
      targetLabel: 'Board tokens',
      careersUrlTemplate: 'https://boards.greenhouse.io/{boardToken}',
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
      const url = `${API_BASE}/${encodeURIComponent(token)}/jobs`;
      const data = await fetchJson(url, {
        timeoutMs: options.timeoutMs ?? Math.min(this.timeoutMs, 8000),
      });
      const count = Array.isArray(data?.jobs) ? data.jobs.length : 0;
      return { ok: true, latencyMs: Date.now() - started, sampleCount: count };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: err.message };
    }
  }

  async fetchJobs(filters = {}, options = {}) {
    const page = options.page || 1;
    const limit = Math.min(options.limit || this.maxResults, this.maxResults);
    const hooks = options.hooks || {};

    if (isMockMode()) {
      await mockDelay();
      const pool = filterJobs(
        loadMockJobs().filter((j) => j.source === 'greenhouse'),
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

    const boards = requireTargets('greenhouse', { filters });
    const companyFilter = (filters.company || '').toLowerCase();
    const selectedBoards = companyFilter
      ? boards.filter((b) => b.toLowerCase().includes(companyFilter))
      : boards;

    if (selectedBoards.length === 0) {
      return finalizeLiveSearch([], filters, { page, limit }, { fetched: 0 });
    }

    const fetchStarted = Date.now();
    const { items: rawJobs, errors } = await fetchTargetsParallel(
      'greenhouse',
      selectedBoards,
      (board) => this.fetchBoardJobs(board, filters),
      filters,
      { onCompanyDone: hooks.onCompanyDone }
    );

    if (rawJobs.length === 0 && errors.length > 0) {
      throw new Error(errors.map((e) => `${e.target}: ${e.error}`).join('; '));
    }

    const filterStarted = Date.now();
    const normalized = [];
    for (const raw of rawJobs) {
      let job = this.normalize(raw.job, raw.board);
      if (!greenhouseFetchContent() && !isFastScan() && needsContent(job, filters)) {
        job = await this.enrichWithContent(job, raw.board);
      }
      normalized.push(job);
    }

    return finalizeLiveSearch(normalized, filters, { page, limit }, {
      fetched: rawJobs.length,
      filterMs: Date.now() - filterStarted,
      fetchMs: Date.now() - fetchStarted,
    });
  }

  async fetchBoardJobs(boardToken, filters) {
    const withContent = greenhouseFetchContent();
    const params = new URLSearchParams();
    if (withContent) params.set('content', 'true');
    const url = `${API_BASE}/${encodeURIComponent(boardToken)}/jobs?${params}`;
    let httpStatus = null;
    try {
      const data = await fetchJson(url, {
        timeoutMs: this.timeoutMs,
        onHttpResponse: (r) => {
          httpStatus = r.status;
        },
      });
      const apiJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const rawFetched = apiJobs.length;
      const intent = detectScanIntent(filters.keywords);
      const efFilters =
        intent.ai && AI_PRIORITY_TOKENS.has(boardToken)
          ? { ...filters, _aiLocationBypass: true }
          : filters;
      if (efFilters._aiLocationBypass) {
        console.log(`[planner] greenhouse/${boardToken} aiLocationBypass=true (AI intent)`);
      }
      const afterEarly = apiJobs.filter((job) =>
        passesEarlyFilter({ ...job, _boardToken: boardToken }, efFilters, 'greenhouse')
      );
      const mapped = afterEarly.slice(0, this.maxResults).map((job) => ({
        board: boardToken,
        job: { ...job, _boardToken: boardToken },
      }));

      reportTargetFetch('greenhouse', boardToken, {
        url,
        httpStatus: httpStatus ?? 200,
        rawFetched,
        afterEarlyFilter: afterEarly.length,
        normalized: mapped.length,
        sampleRawTitles: apiJobs.slice(0, 5).map((j) => j.title),
      });

      return mapped;
    } catch (err) {
      reportTargetFetchError('greenhouse', boardToken, {
        url,
        httpStatus: err.httpStatus ?? httpStatus,
        httpBody: err.httpBody ?? null,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  async enrichWithContent(job, boardToken) {
    const jobId = job.rawData?.id;
    if (!jobId) return job;
    try {
      const url = `${API_BASE}/${encodeURIComponent(boardToken)}/jobs/${jobId}`;
      const detail = await fetchJson(url, { timeoutMs: Math.min(this.timeoutMs, 5000) });
      const description = stripHtml(detail.content || '');
      return { ...job, description, rawData: { ...job.rawData, content: detail.content } };
    } catch {
      return job;
    }
  }

  normalize(rawJob, boardToken = '') {
    if (this.isUnifiedJob(rawJob)) return rawJob;
    if (this.isLegacyMock(rawJob)) {
      return legacyMockToJob({ ...rawJob, source: 'greenhouse', atsType: 'greenhouse' });
    }

    const token = boardToken || rawJob._boardToken || '';
    const location =
      rawJob.location?.name ||
      [rawJob.location?.city, rawJob.location?.region].filter(Boolean).join(', ') ||
      '';

    const description = stripHtml(rawJob.content || rawJob.description || '');

    const job = buildNormalizedJob({
      source: 'greenhouse',
      atsType: 'greenhouse',
      company: rawJob.company_name || rawJob.company?.name || titleCase(token),
      title: rawJob.title || '',
      location,
      workMode: inferWorkModeFromGreenhouse(rawJob),
      employmentType: mapEmployment(rawJob.employment_type),
      applyUrl: rawJob.absolute_url || rawJob.applyUrl || '',
      description,
      postedDate: rawJob.first_published || rawJob.updated_at || null,
      rawData: rawJob,
    });
    job.visaSignals = { fit: 'unknown', sponsorshipMentioned: false, cptMentioned: false };
    return job;
  }

  isUnifiedJob(job) {
    return Boolean(job?.source && job?.atsType && job?.applyUrl !== undefined);
  }

  isLegacyMock(job) {
    return String(job?.id || '').startsWith('mock-');
  }
}

function needsContent(job, filters) {
  return Boolean(filters.visaFit || filters.keywords);
}

function inferWorkModeFromGreenhouse(raw) {
  const loc = JSON.stringify(raw.location || {}).toLowerCase();
  if (loc.includes('remote')) return 'remote';
  if (loc.includes('hybrid')) return 'hybrid';
  return loc.includes('onsite') || loc.includes('on-site') ? 'onsite' : '';
}

function mapEmployment(v) {
  const m = {
    FULL_TIME: 'full_time',
    PART_TIME: 'part_time',
    CONTRACT: 'contract',
    INTERN: 'internship',
  };
  return m[v] || (v ? String(v).toLowerCase() : 'full_time');
}

function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
