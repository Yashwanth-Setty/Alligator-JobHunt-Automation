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

const API_BASE = 'https://api.ashbyhq.com/posting-api/job-board';

// Ashby's posting-api has a documented ≥10s server-side latency floor that is
// independent of board size.  The global SOURCE_TIMEOUT_MS (60s) is the outer
// wall, but individual board fetches must also use a longer-than-default value
// and retry on transient failures (abort / 5xx).
const ASHBY_TIMEOUT_MS = 30_000;
const ASHBY_MAX_RETRIES = 2;   // 3 total attempts: initial + 2 retries

function isTransient(err) {
  if (err.name === 'AbortError') return true;
  const status = err.httpStatus ?? 0;
  // 408 = our own timeout sentinel; 429 = rate-limit; 5xx = server error
  return status === 408 || status === 429 || status >= 500;
}

export class AshbyAdapter extends JobSourceAdapter {
  constructor(config = {}) {
    super({ name: 'ashby', atsType: 'ashby', label: 'Ashby', ...config });
  }

  metadata() {
    return {
      ...super.metadata(),
      label: 'Ashby',
      targetLabel: 'Board names',
      careersUrlTemplate: 'https://jobs.ashbyhq.com/{boardToken}',
    };
  }

  validateTarget(target) {
    const result = validateBoardTokenTarget(target);
    if (!result.valid) return result;
    const token = resolveBoardToken(target);
    if (token !== token.trim()) {
      return { valid: false, error: 'Ashby board names must not have leading/trailing spaces' };
    }
    return { valid: true };
  }

  async healthCheck(target, options = {}) {
    const token = resolveBoardToken(target);
    const validation = this.validateTarget(token);
    if (!validation.valid) return { ok: false, error: validation.error };
    if (isMockMode()) return { ok: true, mode: 'mock' };

    const started = Date.now();
    try {
      const url = `${API_BASE}/${encodeURIComponent(token)}`;
      const data = await fetchJson(url, {
        timeoutMs: options.timeoutMs ?? ASHBY_TIMEOUT_MS,
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

    if (isMockMode()) {
      await mockDelay();
      const pool = filterJobs(
        loadMockJobs().filter((j) => j.source === 'ashby'),
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

    const boards = requireTargets('ashby');
    const companyFilter = (filters.company || '').toLowerCase();
    const selected = companyFilter
      ? boards.filter((b) => b.toLowerCase().includes(companyFilter))
      : boards;

    if (selected.length === 0) {
      return finalizeLiveSearch([], filters, { page, limit }, { fetched: 0 });
    }

    const { items: rawJobs, errors } = await fetchTargetsParallel(
      'ashby',
      selected,
      (board) => this.fetchBoardJobsWithRetry(board, filters),
      filters,
      { onCompanyDone: options.hooks?.onCompanyDone }
    );

    if (rawJobs.length === 0 && errors.length > 0) {
      throw new Error(errors.map((e) => `${e.target}: ${e.error}`).join('; '));
    }

    const normalized = rawJobs.map((raw) => this.normalize(raw.job, raw.board));
    return finalizeLiveSearch(normalized, filters, { page, limit }, { fetched: normalized.length });
  }

  /**
   * Fetch one Ashby board with retry + exponential backoff.
   * Transient errors (timeout, 429, 5xx) are retried up to ASHBY_MAX_RETRIES times.
   * Non-transient errors (404, 400) are surfaced immediately.
   */
  async fetchBoardJobsWithRetry(boardName, filters) {
    let lastErr;
    for (let attempt = 1; attempt <= ASHBY_MAX_RETRIES + 1; attempt++) {
      if (attempt > 1) {
        // Exponential backoff: 1s, 2s … + up to 500ms jitter
        const backoffMs = 1000 * 2 ** (attempt - 2) + Math.floor(Math.random() * 500);
        console.log(`[ashby] fetch target=${boardName} attempt=${attempt} retrying after ${backoffMs}ms (${lastErr?.message})`);
        await delay(backoffMs);
      } else {
        console.log(`[ashby] fetch target=${boardName} attempt=${attempt}`);
      }
      try {
        const result = await this.fetchBoardJobs(boardName, filters);
        if (attempt > 1) {
          console.log(`[ashby] fetch target=${boardName} attempt=${attempt} status=ok (recovered)`);
        }
        return result;
      } catch (err) {
        lastErr = err;
        const status = err.httpStatus ?? 'error';
        console.log(`[ashby] fetch target=${boardName} attempt=${attempt} status=${status} error="${err.message}"`);
        if (!isTransient(err)) throw err;   // non-transient: 404/400/etc — don't retry
      }
    }
    throw lastErr;
  }

  /** @param {string} boardName */
  async fetchBoardJobs(boardName, filters) {
    const params = new URLSearchParams();
    if (!isFastScan()) params.set('includeCompensation', 'true');
    const url = `${API_BASE}/${encodeURIComponent(boardName)}?${params}`;
    let httpStatus = null;
    try {
      const data = await fetchJson(url, {
        timeoutMs: ASHBY_TIMEOUT_MS,
        onHttpResponse: (r) => {
          httpStatus = r.status;
        },
      });
      const apiJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      const rawFetched = apiJobs.length;
      const afterEarly = apiJobs.filter((job) =>
        passesEarlyFilter({ ...job, _boardName: boardName }, filters, 'ashby')
      );
      const mapped = afterEarly.slice(0, this.maxResults).map((job) => ({
        board: boardName,
        job: { ...job, _boardName: boardName },
      }));

      reportTargetFetch('ashby', boardName, {
        url,
        httpStatus: httpStatus ?? 200,
        rawFetched,
        afterEarlyFilter: afterEarly.length,
        normalized: mapped.length,
        sampleRawTitles: apiJobs.slice(0, 5).map((j) => j.title),
      });

      return mapped;
    } catch (err) {
      reportTargetFetchError('ashby', boardName, {
        url,
        httpStatus: err.httpStatus ?? httpStatus,
        httpBody: err.httpBody ?? null,
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  normalize(rawJob, boardName = '') {
    if (this.isUnifiedJob(rawJob)) return rawJob;
    if (this.isLegacyMock(rawJob)) {
      return legacyMockToJob({ ...rawJob, source: 'ashby', atsType: 'ashby' });
    }

    const location = rawJob.locationName || rawJob.location || '';
    const description = isFastScan()
      ? ''
      : stripHtml(rawJob.descriptionPlain || rawJob.description || '');

    const salary = parseAshbyCompensation(rawJob.compensation);

    const job = buildNormalizedJob({
      source: 'ashby',
      atsType: 'ashby',
      company: rawJob.companyName || boardName || '',
      title: rawJob.title || '',
      location,
      workMode: inferWorkModeFromAshby(rawJob),
      employmentType: mapAshbyType(rawJob.employmentType),
      applyUrl: rawJob.applyUrl || rawJob.jobUrl || '',
      description,
      postedDate: rawJob.publishedAt || null,
      rawData: rawJob,
    });
    job.visaSignals = { fit: 'unknown', sponsorshipMentioned: false, cptMentioned: false };
    job.salary = salary;
    return job;
  }

  isUnifiedJob(job) {
    return Boolean(job?.source && job?.atsType && job?.visaSignals && job?.applyUrl !== undefined);
  }

  isLegacyMock(job) {
    return String(job?.id || '').startsWith('mock-');
  }
}

function inferWorkModeFromAshby(raw) {
  const loc = `${raw.locationName || ''} ${raw.workplaceType || ''}`.toLowerCase();
  if (loc.includes('remote')) return 'remote';
  if (loc.includes('hybrid')) return 'hybrid';
  if (raw.workplaceType === 'OnSite' || loc.includes('onsite')) return 'onsite';
  return '';
}

function mapAshbyType(t) {
  const v = (t || '').toLowerCase();
  if (v.includes('intern')) return 'internship';
  if (v.includes('contract')) return 'contract';
  if (v.includes('part')) return 'part_time';
  return 'full_time';
}

function parseAshbyCompensation(comp) {
  if (!comp) return { min: null, max: null, currency: 'USD', display: null };
  return {
    min: comp.minValue ?? comp.summaryComponents?.[0]?.minValue ?? null,
    max: comp.maxValue ?? comp.summaryComponents?.[0]?.maxValue ?? null,
    currency: comp.currencyCode || 'USD',
    display: comp.compensationTierSummary || comp.scrapeableCompensationSalarySummary || null,
  };
}
