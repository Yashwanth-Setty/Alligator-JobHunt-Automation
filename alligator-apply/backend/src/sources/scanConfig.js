/** Central scan performance configuration */

export function isFastScan() {
  return process.env.FAST_SCAN === 'true';
}

export function greenhouseFetchContent() {
  if (isFastScan()) return false;
  return process.env.GREENHOUSE_FETCH_CONTENT === 'true';
}

export function getSourceTimeoutMs() {
  return Number(process.env.SOURCE_TIMEOUT_MS || 12000);
}

/** Hard cap on total scan duration — scan always completes within this window. */
export function getScanTimeoutMs() {
  return Number(process.env.SCAN_TIMEOUT_MS || 60000);
}

/** Per-provider budget when sources run in parallel (fair share of scan timeout). */
export function getPerProviderTimeoutMs(providerCount = 5) {
  const scanMs = getScanTimeoutMs();
  const sourceMs = getSourceTimeoutMs();
  const fairShare = Math.floor((scanMs * 0.85) / Math.max(1, providerCount));
  return Math.max(sourceMs, Math.min(sourceMs * 8, fairShare));
}

export function getMaxResultsPerSource() {
  return Number(process.env.MAX_RESULTS_PER_SOURCE || 50);
}

export function getMaxCompaniesPerSource() {
  return Number(process.env.MAX_COMPANIES_PER_SOURCE || 10);
}

export function getMaxTotalResults() {
  return Number(process.env.MAX_TOTAL_RESULTS || 200);
}

export function getSourceCacheTtlMinutes() {
  return Number(process.env.SOURCE_CACHE_TTL_MINUTES || 30);
}

export function getCompanyConcurrency() {
  return Number(process.env.COMPANY_CONCURRENCY || 3);
}

export function getMockDelayMs() {
  if (isFastScan()) return 20;
  return 120;
}

export const SCAN_PHASES = [
  'fetching',
  'filtering',
  'deduplicating',
  'visa_detection',
  'quality_scoring',
  'completed',
];
