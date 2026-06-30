import { withTimeout } from '../utils.js';
import { mergeRejectionCounts } from '../jobFetchFilter.js';

/**
 * Run a provider through the standard paginated fetch loop.
 * @param {import('./providerContract.js').JobSourceProvider} provider
 * @param {import('../types.js').SearchFilters} filters
 * @param {{ onCompanyDone?: (info: object) => void }} [hooks]
 */
export async function runProviderSearch(provider, filters, hooks = {}) {
  const started = Date.now();
  try {
    const allJobs = [];
    let page = 1;
    let hasMore = true;
    let stats = { fetched: 0, afterFilters: 0, rejectionCounts: {} };

    while (hasMore && allJobs.length < provider.maxResults) {
      const remaining = provider.maxResults - allJobs.length;
      if (remaining <= 0) break;

      const result = await withTimeout(
        provider.fetchJobs(filters, { page, limit: remaining, hooks }),
        provider.timeoutMs,
        `${provider.name} fetch page ${page}`
      );

      const batch = (result.jobs || []).map((j) =>
        j.applyUrl !== undefined ? j : provider.normalize(j.rawData || j)
      );
      allJobs.push(...batch);

      if (batch.length > 0 || stats.fetched === 0) {
        stats = {
          fetched: Math.max(stats.fetched, result.stats?.fetched ?? batch.length),
          afterFilters: Math.max(stats.afterFilters, result.stats?.afterFilters ?? batch.length),
          fetchMs: result.stats?.fetchMs,
          filterMs: result.stats?.filterMs,
          rejectionCounts: mergeRejectionCounts(stats.rejectionCounts, result.stats?.rejectionCounts),
        };
      }

      hasMore = Boolean(result.hasMore) && batch.length > 0;
      page += 1;
      if (page > 5) break;
    }

    return {
      jobs: allJobs.slice(0, provider.maxResults),
      durationMs: Date.now() - started,
      stats,
    };
  } catch (err) {
    return {
      jobs: [],
      durationMs: Date.now() - started,
      error: err.message || String(err),
      stack: err.stack,
      stats: { fetched: 0, afterFilters: 0 },
    };
  }
}

/** @deprecated Use runProviderSearch */
export const runAdapterSearch = runProviderSearch;
