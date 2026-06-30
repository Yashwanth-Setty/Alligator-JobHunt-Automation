import { filterJobsWithStats } from './jobFetchFilter.js';
import { paginateJobs, delay } from './utils.js';
import { getTargetsForSource } from './sourceConfig.js';
import { mapWithConcurrency } from './concurrency.js';
import { getCachedSourceResult, setCachedSourceResult, hashTargetList } from './sourceCache.js';
import {
  getCompanyConcurrency,
  getMaxCompaniesPerSource,
  getMockDelayMs,
  isFastScan,
} from './scanConfig.js';
import { detectVisaSignals } from './visaSignals.js';
import { reportTargetFetch, reportTargetFetchError } from '../services/scanDiagnostics.js';

export function isMockMode() {
  return process.env.MOCK_MODE !== 'false';
}

export function requireTargets(sourceName, options = {}) {
  const targets = getLimitedTargets(sourceName, options);
  if (targets.length === 0) {
    throw new Error(
      `No targets configured for ${sourceName}. Set env or add entries in Settings.`
    );
  }
  return targets;
}

export function getLimitedTargets(sourceName, options = {}) {
  const all = getTargetsForSource(sourceName, options);
  const max = getMaxCompaniesPerSource();
  return all.slice(0, max);
}

function registryTargetCacheKey(target) {
  if (typeof target === 'string') return target;
  return target.boardToken || target.id || JSON.stringify(target.connectionPayload || {});
}

/**
 * Fetch registry targets (connection_payload providers) in parallel.
 * @template T
 * @param {string} sourceName
 * @param {import('./providers/providerContract.js').ProviderTarget[]} targets
 * @param {(target: import('./providers/providerContract.js').ProviderTarget) => Promise<T[]>} fetcher
 * @param {import('./types.js').SearchFilters} filters
 * @param {{ onCompanyDone?: (info: object) => void }} [hooks]
 */
export async function fetchRegistryTargetsParallel(
  sourceName,
  targets,
  fetcher,
  filters = {},
  hooks = {}
) {
  const concurrency = getCompanyConcurrency();
  const started = Date.now();
  const targetsHash = hashTargetList(targets);

  const { items, errors } = await mapWithConcurrency(targets, concurrency, async (target) => {
    const companyStarted = Date.now();
    const cacheKey = registryTargetCacheKey(target);
    const cached = getCachedSourceResult(sourceName, cacheKey, filters, targetsHash);
    if (cached) {
      hooks.onCompanyDone?.({
        source: sourceName,
        target: cacheKey,
        durationMs: Date.now() - companyStarted,
        jobs: cached.jobs?.length ?? cached.length ?? 0,
        fromCache: true,
      });
      reportTargetFetch(sourceName, cacheKey, {
        url: '(cache)',
        httpStatus: 200,
        rawFetched: cached.jobs?.length ?? cached.length ?? 0,
        afterEarlyFilter: cached.jobs?.length ?? cached.length ?? 0,
        normalized: cached.jobs?.length ?? cached.length ?? 0,
        fromCache: true,
        durationMs: Date.now() - companyStarted,
      });
      const jobs = cached.jobs || cached;
      return jobs.map((j) => ({ ...j, dataSource: 'cache' }));
    }

    const batch = await fetcher(target);
    const liveBatch = batch.map((j) => ({ ...j, dataSource: j.dataSource || 'live' }));
    setCachedSourceResult(sourceName, cacheKey, filters, { jobs: liveBatch }, targetsHash);
    hooks.onCompanyDone?.({
      source: sourceName,
      target: cacheKey,
      durationMs: Date.now() - companyStarted,
      jobs: liveBatch.length,
      fromCache: false,
    });
    return liveBatch;
  });

  for (const errRow of errors) {
    reportTargetFetchError(sourceName, errRow.target, {
      url: errRow.url,
      httpStatus: errRow.httpStatus,
      httpBody: errRow.httpBody,
      error: errRow.error,
      stack: errRow.stack,
    });
  }

  return {
    items,
    errors,
    durationMs: Date.now() - started,
  };
}

/**
 * Fetch targets in parallel with controlled concurrency.
 * @template T
 * @param {string} sourceName
 * @param {string[]} targets
 * @param {(target: string) => Promise<T[]>} fetcher
 * @param {import('./types.js').SearchFilters} filters
 * @param {{ onCompanyDone?: (info: object) => void }} [hooks]
 */
export async function fetchTargetsParallel(sourceName, targets, fetcher, filters = {}, hooks = {}) {
  const concurrency = getCompanyConcurrency();
  const started = Date.now();
  const targetsHash = hashTargetList(targets);

  const { items, errors } = await mapWithConcurrency(targets, concurrency, async (target) => {
    const companyStarted = Date.now();
    const cached = getCachedSourceResult(sourceName, target, filters, targetsHash);
    if (cached) {
      hooks.onCompanyDone?.({
        source: sourceName,
        target,
        durationMs: Date.now() - companyStarted,
        jobs: cached.jobs?.length ?? cached.length ?? 0,
        fromCache: true,
      });
      reportTargetFetch(sourceName, target, {
        url: '(cache)',
        httpStatus: 200,
        rawFetched: cached.jobs?.length ?? cached.length ?? 0,
        afterEarlyFilter: cached.jobs?.length ?? cached.length ?? 0,
        normalized: cached.jobs?.length ?? cached.length ?? 0,
        fromCache: true,
        durationMs: Date.now() - companyStarted,
      });
      const jobs = cached.jobs || cached;
      return jobs.map((j) => ({ ...j, dataSource: 'cache' }));
    }

    const batch = await fetcher(target);
    const liveBatch = batch.map((j) => ({ ...j, dataSource: j.dataSource || 'live' }));
    setCachedSourceResult(sourceName, target, filters, { jobs: liveBatch }, targetsHash);
    hooks.onCompanyDone?.({
      source: sourceName,
      target,
      durationMs: Date.now() - companyStarted,
      jobs: liveBatch.length,
      fromCache: false,
    });
    return liveBatch;
  });

  for (const errRow of errors) {
    reportTargetFetchError(sourceName, errRow.target, {
      url: errRow.url,
      httpStatus: errRow.httpStatus,
      httpBody: errRow.httpBody,
      error: errRow.error,
      stack: errRow.stack,
    });
  }

  return {
    items,
    errors,
    durationMs: Date.now() - started,
  };
}

/** @deprecated use fetchTargetsParallel */
export async function fetchTargetsSequential(targets, fetcher, pauseMs = 0) {
  const { items, errors } = await mapWithConcurrency(targets, 1, fetcher);
  return { items, errors };
}

export function finalizeLiveSearch(normalized, filters, options, meta = {}) {
  const page = options.page || 1;
  const limit = options.limit || 50;
  const { jobs: afterFilters, rejectionCounts, rejected } = filterJobsWithStats(
    normalized,
    filters,
    { forFetch: true }
  );
  const paged = paginateJobs(afterFilters, page, limit);

  if (rejected.length > 0 && meta.logRejections) {
    console.log(
      `[fetch-filter] fetched=${normalized.length} kept=${afterFilters.length} rejected=${rejected.length}`,
      rejectionCounts
    );
  }

  return {
    ...paged,
    stats: {
      fetched: meta.fetched ?? normalized.length,
      afterFilters: afterFilters.length,
      filterMs: meta.filterMs ?? 0,
      rejectionCounts,
      rejectedSample: rejected.slice(0, 3).map((r) => ({
        title: r.job.title,
        reason: r.reason,
      })),
    },
  };
}

export async function mockDelay() {
  if (isMockMode()) await delay(getMockDelayMs());
}

export function stripHtml(html = '') {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @deprecated use detectVisaSignals */
export function inferVisaFromText(text = '') {
  return detectVisaSignals(text);
}
