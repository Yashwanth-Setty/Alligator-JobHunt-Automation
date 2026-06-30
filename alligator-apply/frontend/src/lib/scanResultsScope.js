/** Filters that define a hunt session — changing these clears resultsScanRunId. */
export const RESULTS_SCOPE_FILTER_KEYS = ['keywords', 'location', 'remoteType'];

/**
 * Stable key for keywords + location + remote (remote-only toggle).
 * minScore and other UI filters do NOT affect scan result scope.
 */
export function resultsScopeFiltersKey(filters = {}) {
  const out = {};
  for (const k of RESULTS_SCOPE_FILTER_KEYS) {
    const v = filters[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      out[k] = String(v).trim();
    }
  }
  return JSON.stringify(
    Object.keys(out)
      .sort()
      .reduce((acc, key) => {
        acc[key] = out[key];
        return acc;
      }, {})
  );
}

/**
 * Whether the UI should keep fetching with the current resultsScanRunId.
 */
export function shouldKeepResultsScope(sessionScopeKey, currentScopeKey, resultsScanRunId) {
  if (!resultsScanRunId) return false;
  if (!sessionScopeKey) return true;
  return sessionScopeKey === currentScopeKey;
}
