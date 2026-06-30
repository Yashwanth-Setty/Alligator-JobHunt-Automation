import { AsyncLocalStorage } from 'async_hooks';
import { getDb } from '../db/database.js';
import { safeJson } from './sourceStore.js';
import { normalizeScanFilters, scanFiltersSignature, computeSourceMetrics } from './scanMetrics.js';
import { filterJobsWithStats, buildFetchFilters } from '../sources/jobFetchFilter.js';

const diagnosticStorage = new AsyncLocalStorage();

const EMPTY_TOTALS = () => ({
  rawFetched: 0,
  afterEarlyFilter: 0,
  normalized: 0,
  afterKeyword: 0,
  afterLocation: 0,
  afterScore: 0,
  afterDedupe: 0,
  persisted: 0,
  errors: [],
});

function targetKey(source, target) {
  return `${source}::${typeof target === 'string' ? target : target?.boardToken || JSON.stringify(target)}`;
}

function sampleTitles(jobs, n = 5) {
  return (jobs || [])
    .slice(0, n)
    .map((j) => j.title || j.job?.title || j.rawData?.title || j.posting?.title || '(no title)')
    .filter(Boolean);
}

/**
 * Measure filter funnel on normalized jobs (fetch filters + optional score).
 */
export function measureFilterStages(jobs, filters = {}, matchThreshold = 50, scoredJobs = null) {
  const normalized = jobs.length;
  if (normalized === 0) {
    return {
      normalized: 0,
      afterKeyword: 0,
      afterLocation: 0,
      afterScore: 0,
      rejectedSamples: [],
    };
  }

  const fetchOnly = buildFetchFilters(filters);
  const keywordFilters = { ...fetchOnly };
  delete keywordFilters.location;
  delete keywordFilters.company;
  delete keywordFilters.source;
  delete keywordFilters.remoteType;
  delete keywordFilters.visaFit;
  delete keywordFilters.employmentType;
  delete keywordFilters.experienceLevel;
  delete keywordFilters.salaryMin;
  delete keywordFilters.salaryMax;

  const afterKeywordResult = filterJobsWithStats(jobs, keywordFilters, { forFetch: true });
  const afterKeyword = afterKeywordResult.jobs.length;

  const afterLocationResult = filterJobsWithStats(jobs, fetchOnly, { forFetch: true });
  const afterLocation = afterLocationResult.jobs.length;

  const scored = scoredJobs || jobs;
  const afterScore = scored.filter((j) => (j.score ?? 0) >= Number(matchThreshold || 50)).length;

  const rejectedSamples = afterLocationResult.rejected.slice(0, 20).map((r) => ({
    title: r.job?.title || '(no title)',
    company: r.job?.company || '',
    location: r.job?.location || '',
    reason: r.reason,
    category: r.category,
  }));

  return {
    normalized,
    afterKeyword,
    afterLocation,
    afterScore,
    rejectedSamples,
  };
}

export class ScanDiagnosticsCollector {
  constructor(scanRunId, meta = {}) {
    this.scanRunId = scanRunId;
    this.filters = meta.filters || {};
    this.searchFilters = meta.searchFilters || scanFiltersSignature(this.filters);
    this.activeSources = meta.activeSources || [];
    this.targetsBySource = meta.targetsBySource || {};
    this.matchThreshold = Number(meta.matchThreshold || 50);
    this.sources = {};
    this.startedAt = new Date().toISOString();
  }

  ensureSource(source) {
    if (!this.sources[source]) {
      this.sources[source] = {
        totals: EMPTY_TOTALS(),
        targets: [],
        sampleRawTitles: [],
        sampleRejected: [],
        providerError: null,
      };
    }
    return this.sources[source];
  }

  recordTarget(source, target, record) {
    const src = this.ensureSource(source);
    const entry = {
      target: typeof target === 'string' ? target : target?.boardToken || target?.companyName || String(target),
      url: record.url ?? null,
      httpStatus: record.httpStatus ?? null,
      rawFetched: record.rawFetched ?? 0,
      afterEarlyFilter: record.afterEarlyFilter ?? record.rawFetched ?? 0,
      normalized: record.normalized ?? 0,
      afterKeyword: record.afterKeyword ?? 0,
      afterLocation: record.afterLocation ?? 0,
      afterScore: record.afterScore ?? 0,
      afterDedupe: record.afterDedupe ?? 0,
      persisted: record.persisted ?? 0,
      error: record.error ?? null,
      stack: record.stack ?? null,
      httpBody: record.httpBody ?? null,
      fromCache: Boolean(record.fromCache),
      durationMs: record.durationMs ?? null,
      sampleRawTitles: record.sampleRawTitles || [],
    };

    const existingIdx = src.targets.findIndex((t) => t.target === entry.target);
    if (existingIdx >= 0) src.targets[existingIdx] = { ...src.targets[existingIdx], ...entry };
    else src.targets.push(entry);

    this._rollupSourceTotals(source);
    this._logTarget(source, entry);
    return entry;
  }

  recordTargetError(source, target, { url, error, stack, httpStatus = null, httpBody = null }) {
    return this.recordTarget(source, target, {
      url,
      httpStatus,
      httpBody: httpBody ? String(httpBody).slice(0, 500) : null,
      rawFetched: 0,
      error: error || 'unknown error',
      stack: stack || null,
    });
  }

  recordProviderResult(source, {
    jobs = [],
    scoredJobs = [],
    stats = {},
    error = null,
    stack = null,
    dedupedCount = null,
    persistedCount = null,
  }) {
    const src = this.ensureSource(source);
    if (error) {
      src.providerError = { message: error, stack };
      src.totals.errors.push(error);
    }

    const stages = measureFilterStages(jobs, this.filters, this.matchThreshold, scoredJobs);
    src.totals.rawFetched = Math.max(src.totals.rawFetched, stats.fetched ?? stages.normalized);
    src.totals.normalized = Math.max(src.totals.normalized, stages.normalized);
    src.totals.afterKeyword = stages.afterKeyword;
    src.totals.afterLocation = stages.afterLocation;
    src.totals.afterScore = stages.afterScore;
    if (dedupedCount != null) src.totals.afterDedupe = dedupedCount;
    if (persistedCount != null) src.totals.persisted = persistedCount;

    src.sampleRawTitles = sampleTitles(jobs, 5);
    src.sampleRejected = stages.rejectedSamples.slice(0, 5);

    console.log(
      `[scan-diag] ${source} SUMMARY raw=${src.totals.rawFetched} norm=${src.totals.normalized} kw=${src.totals.afterKeyword} loc=${src.totals.afterLocation} score=${src.totals.afterScore} dedupe=${src.totals.afterDedupe} persisted=${src.totals.persisted}${error ? ` error=${error}` : ''}`
    );
  }

  recordPersistedBySource(source, count) {
    const src = this.ensureSource(source);
    src.totals.persisted = count;
  }

  recordGlobalDedupe(sourceCounts) {
    for (const [source, count] of Object.entries(sourceCounts || {})) {
      const src = this.ensureSource(source);
      src.totals.afterDedupe = count;
    }
  }

  _rollupSourceTotals(source) {
    const src = this.ensureSource(source);
    const totals = EMPTY_TOTALS();
    for (const t of src.targets) {
      totals.rawFetched += t.rawFetched || 0;
      totals.afterEarlyFilter += t.afterEarlyFilter || 0;
      totals.normalized += t.normalized || 0;
      if (t.error) totals.errors.push(`${t.target}: ${t.error}`);
    }
    src.totals.rawFetched = Math.max(src.totals.rawFetched, totals.rawFetched);
    src.totals.afterEarlyFilter = Math.max(src.totals.afterEarlyFilter, totals.afterEarlyFilter);
    if (totals.errors.length) src.totals.errors = [...new Set([...src.totals.errors, ...totals.errors])];
  }

  _logTarget(source, entry) {
    console.log(
      `[scan-diag] ${source}/${entry.target} url=${entry.url ?? 'n/a'} status=${entry.httpStatus ?? 'n/a'} raw=${entry.rawFetched} early=${entry.afterEarlyFilter} norm=${entry.normalized} kw=${entry.afterKeyword} loc=${entry.afterLocation} score=${entry.afterScore} dedupe=${entry.afterDedupe} persisted=${entry.persisted}${entry.error ? ` error=${entry.error}` : ''}${entry.fromCache ? ' (cache)' : ''}`
    );
    if (entry.stack) {
      console.log(`[scan-diag] ${source}/${entry.target} stack=${entry.stack.split('\n').slice(0, 3).join(' | ')}`);
    }
  }

  toJSON() {
    return {
      scanRunId: this.scanRunId,
      startedAt: this.startedAt,
      filters: normalizeScanFilters(this.filters),
      searchFilters: this.searchFilters,
      activeSources: this.activeSources,
      targetsBySource: this.targetsBySource,
      matchThreshold: this.matchThreshold,
      sources: this.sources,
    };
  }

  buildFailedSourcesReport(failedSourceNames = []) {
    return failedSourceNames.map((name) => buildSourceFailureDetail(name, this));
  }
}

/**
 * Factual failure detail for a provider — message, stack, first target HTTP facts.
 * @param {string} sourceName
 * @param {ScanDiagnosticsCollector|object|null} collector
 */
export function buildSourceFailureDetail(sourceName, collector) {
  const src = collector?.sources?.[sourceName];
  const failedTarget = src?.targets?.find((t) => t.error) || src?.targets?.[0] || null;
  const providerError = src?.providerError;

  const error =
    providerError?.message ||
    failedTarget?.error ||
    src?.totals?.errors?.[0] ||
    null;

  if (!error) {
    return {
      name: sourceName,
      error: null,
      stack: null,
      firstFailedTarget: failedTarget?.target ?? null,
      requestUrl: failedTarget?.url ?? null,
      httpStatus: failedTarget?.httpStatus ?? null,
      httpBody: failedTarget?.httpBody ?? null,
    };
  }

  return {
    name: sourceName,
    error,
    stack: providerError?.stack || failedTarget?.stack || null,
    firstFailedTarget: failedTarget?.target ?? null,
    requestUrl: failedTarget?.url ?? null,
    httpStatus: failedTarget?.httpStatus ?? null,
    httpBody: failedTarget?.httpBody ?? null,
  };
}

/** Merge persisted failure details onto sourceStatuses rows (for API responses). */
export function applyFailureDetailsToStatuses(sourceStatuses = [], scanReport = null) {
  const details = scanReport?.failedSourceDetails;
  if (!details?.length) return sourceStatuses;
  const byName = Object.fromEntries(details.map((d) => [d.name, d]));
  return sourceStatuses.map((s) => {
    if (s.status !== 'failed') return s;
    const d = byName[s.name];
    if (!d) return s;
    return {
      ...s,
      error: d.error ?? s.error ?? null,
      stack: d.stack ?? s.stack ?? null,
      firstFailedTarget: d.firstFailedTarget ?? s.firstFailedTarget ?? null,
      requestUrl: d.requestUrl ?? s.requestUrl ?? null,
      httpStatus: d.httpStatus ?? s.httpStatus ?? null,
      httpBody: d.httpBody ?? s.httpBody ?? null,
    };
  });
}

/** Merge failure facts onto a sourceStatuses row (no behavior change). */
export function enrichFailedSourceStatus(statusRow, collector) {
  if (!statusRow || statusRow.status !== 'failed') return statusRow;
  const detail = buildSourceFailureDetail(statusRow.name, collector);
  return {
    ...statusRow,
    error: detail.error || statusRow.error || null,
    stack: detail.stack || statusRow.stack || null,
    firstFailedTarget: detail.firstFailedTarget,
    requestUrl: detail.requestUrl,
    httpStatus: detail.httpStatus,
    httpBody: detail.httpBody,
  };
}

export function buildFailedSourcesReport(collector, failedSourceNames = []) {
  if (collector?.buildFailedSourcesReport) {
    return collector.buildFailedSourcesReport(failedSourceNames);
  }
  return failedSourceNames.map((name) => buildSourceFailureDetail(name, collector));
}

/** Active collector for current async scan context. */
export function getActiveScanDiagnostics() {
  return diagnosticStorage.getStore()?.collector ?? null;
}

export function runWithScanDiagnostics(collector, fn) {
  return diagnosticStorage.run({ collector }, fn);
}

const persistedCollectors = new Map();

export function registerScanDiagnostics(collector) {
  if (collector?.scanRunId) persistedCollectors.set(collector.scanRunId, collector);
  return collector;
}

export function getStoredScanDiagnostics(scanRunId) {
  return persistedCollectors.get(scanRunId) ?? null;
}

export function attachDiagnosticsToScanReport(scanReport, collector, failedSourceNames = []) {
  if (!collector) return scanReport;
  registerScanDiagnostics(collector);
  const failedSourceDetails = buildFailedSourcesReport(collector, failedSourceNames);
  return {
    ...(scanReport || {}),
    diagnostics: collector.toJSON(),
    failedSourceDetails,
  };
}

/**
 * GET /api/jobs/debug/scan/:scanRunId — factual scan pipeline report.
 */
export function getScanDebugReport(scanRunId) {
  const db = getDb();
  const run = db.prepare('SELECT * FROM scan_runs WHERE id = ?').get(scanRunId);
  if (!run) return null;

  const scanReport = safeJson(run.scan_report, {});
  const storedDiag =
    scanReport?.diagnostics ||
    getStoredScanDiagnostics(scanRunId)?.toJSON() ||
    null;

  const persistedBySource = computeSourceMetrics(scanRunId);
  const filters = safeJson(run.search_filters, {});
  const failedSources = safeJson(run.failed_sources, []);
  const sourceSummary = safeJson(run.source_summary, []);
  const failedSourceDetails =
    scanReport?.failedSourceDetails ||
    buildFailedSourcesReport(storedDiag ? { sources: storedDiag.sources } : null, failedSources);

  const perSource = {};
  const sourceNames = new Set([
    ...(storedDiag?.activeSources || []),
    ...Object.keys(storedDiag?.sources || {}),
    ...Object.keys(persistedBySource || {}),
    ...sourceSummary.map((s) => s.name),
  ]);

  for (const name of sourceNames) {
    const diag = storedDiag?.sources?.[name] || {};
    const totals = diag.totals || EMPTY_TOTALS();
    const persisted = persistedBySource[name]?.persisted ?? totals.persisted ?? 0;
    const summaryRow = sourceSummary.find((s) => s.name === name);

    const detail = failedSourceDetails.find((d) => d.name === name);

    perSource[name] = {
      totals: {
        rawFetched: totals.rawFetched ?? summaryRow?.jobsFetched ?? 0,
        normalized: totals.normalized ?? 0,
        afterKeyword: totals.afterKeyword ?? 0,
        afterLocation: totals.afterLocation ?? totals.afterEarlyFilter ?? summaryRow?.jobsAfterFilters ?? 0,
        afterScore: totals.afterScore ?? 0,
        afterDedupe: totals.afterDedupe ?? 0,
        persisted,
        errors: totals.errors?.length
          ? totals.errors
          : detail?.error
            ? [detail.error]
            : summaryRow?.error
              ? [summaryRow.error]
              : diag.providerError
                ? [diag.providerError.message]
                : [],
      },
      targets: diag.targets || [],
      sampleRawTitles: diag.sampleRawTitles || [],
      sampleRejected: diag.sampleRejected || [],
      providerError: detail
        ? {
            message: detail.error,
            stack: detail.stack,
            firstFailedTarget: detail.firstFailedTarget,
            requestUrl: detail.requestUrl,
            httpStatus: detail.httpStatus,
            httpBody: detail.httpBody,
          }
        : diag.providerError || (summaryRow?.error ? { message: summaryRow.error } : null),
      failure: detail || null,
      status: summaryRow?.status ?? null,
    };

    if (totals.rawFetched > 0 && persisted === 0 && perSource[name].sampleRejected.length === 0) {
      perSource[name].analysis =
        'rawFetched > 0 but persisted = 0 — check afterKeyword/afterLocation/afterScore totals and sampleRejected for filter stage that dropped jobs';
    } else if (totals.rawFetched === 0 && !diag.providerError && !summaryRow?.error) {
      perSource[name].analysis =
        'rawFetched = 0 — inspect target rows for HTTP status, URL, and error fields';
    } else if (detail?.error || diag.providerError || summaryRow?.error) {
      perSource[name].analysis = 'provider failed — see failure / providerError / target errors';
    }
  }

  return {
    scanRunId,
    status: run.status,
    message: run.message,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    scanFilters: filters,
    searchFiltersSignature: run.search_filters,
    selectedSources: storedDiag?.activeSources || [],
    selectedTargets: storedDiag?.targetsBySource || {},
    failedSources: failedSourceDetails,
    failedSourceNames: failedSources,
    failedSourceDetails,
    sourceStatuses: applyFailureDetailsToStatuses(sourceSummary, { failedSourceDetails }),
    jobsFound: run.jobs_found,
    persistedBySource,
    perSource,
    diagnosticsAvailable: Boolean(storedDiag),
    rawDiagnostics: storedDiag,
  };
}

/** Helper for adapters — record HTTP fetch facts without changing control flow. */
export function reportTargetFetch(source, target, facts) {
  getActiveScanDiagnostics()?.recordTarget(source, target, facts);
}

export function reportTargetFetchError(source, target, facts) {
  getActiveScanDiagnostics()?.recordTargetError(source, target, facts);
}
