import { getDb } from '../db/database.js';
import { safeJson } from './sourceStore.js';
import { applyFailureDetailsToStatuses } from './scanDiagnostics.js';

/** Mark orphaned in-progress scans after server restart. */
export function recoverInterruptedScans() {
  const db = getDb();
  const ts = new Date().toISOString();
  db.prepare(
    `UPDATE scan_runs SET status = 'cancelled', message = 'Scan interrupted (server restart)', finished_at = ?
     WHERE status = 'running'`
  ).run(ts);
}

/** Latest scan run row from SQLite. */
export function getLatestScanRun() {
  return getDb()
    .prepare('SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1')
    .get();
}

/** Normalize scan search filters for storage and lookup. */
export function normalizeScanFilters(filters = {}) {
  const keys = ['keywords', 'location', 'remoteType', 'source', 'minScore', 'company'];
  const out = {};
  for (const k of keys) {
    const v = filters[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      out[k] = String(v).trim();
    }
  }
  return out;
}

/** Stable signature for matching scan runs to UI search filters. */
export function scanFiltersSignature(filters = {}) {
  const normalized = normalizeScanFilters(filters);
  const sorted = Object.keys(normalized)
    .sort()
    .reduce((acc, k) => {
      acc[k] = normalized[k];
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

function visibleJobsWhere(scanRunId) {
  if (scanRunId) {
    return {
      where: 'COALESCE(is_hidden, 0) = 0 AND scan_run_id = @scanRunId',
      params: { scanRunId },
    };
  }
  return { where: 'COALESCE(is_hidden, 0) = 0', params: {} };
}

function countVisibleJobsForScan(db, scanRunId) {
  if (!scanRunId) return 0;
  return db
    .prepare(
      'SELECT COUNT(*) AS c FROM jobs WHERE scan_run_id = ? AND COALESCE(is_hidden, 0) = 0'
    )
    .get(scanRunId).c;
}

/**
 * Scan run id for listJobs + KPI.
 * Priority: explicit scanRunId → running scan → completed scan matching filters → null.
 * Never falls back to an older completed scan when the latest scan differs.
 */
export function resolveActiveScanRunId(options = {}) {
  const db = getDb();

  if (options.scanRunId) {
    return String(options.scanRunId).trim();
  }

  const sig = options.filters ? scanFiltersSignature(options.filters) : null;

  const running = db
    .prepare(
      `SELECT id, search_filters FROM scan_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`
    )
    .get();
  if (running?.id) {
    if (!sig || running.search_filters === sig) {
      return running.id;
    }
  }

  if (sig) {
    const matched = db
      .prepare(
        `SELECT id FROM scan_runs
         WHERE status = 'completed' AND search_filters = ?
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(sig);
    return matched?.id ?? null;
  }

  return null;
}

/** @deprecated alias — use resolveActiveScanRunId */
export function getActiveScanRunId(options = {}) {
  return resolveActiveScanRunId(options);
}

/**
 * Resolve scan scope for list/kpi/funnel — honors explicit scanRunId from client.
 * @returns {{ requestedScanRunId: string|null, activeScanRunId: string|null }}
 */
export function resolveScanScope(filters = {}) {
  const requestedScanRunId = filters.scanRunId ? String(filters.scanRunId).trim() : null;
  const activeScanRunId = resolveActiveScanRunId({
    scanRunId: requestedScanRunId || undefined,
    filters: requestedScanRunId ? undefined : filters,
  });
  return { requestedScanRunId, activeScanRunId };
}

export function logScanScope(label, filters = {}) {
  const { requestedScanRunId, activeScanRunId } = resolveScanScope(filters);
  console.log(
    `[jobs] ${label}: requestedScanRunId=${requestedScanRunId ?? 'none'} activeScanRunId=${activeScanRunId ?? 'none'}`
  );
  return { requestedScanRunId, activeScanRunId };
}

function resolveMetricsScope(scanRunId = null, filters = null) {
  const id = scanRunId ?? resolveActiveScanRunId({ filters: filters || undefined });
  if (id) return visibleJobsWhere(id);
  return { where: '1=0', params: {} };
}

/**
 * Single source of truth for job counts — always from persisted SQLite rows.
 */
export function computePersistedMetrics(scanRunId = null, filters = null) {
  const db = getDb();
  const id = scanRunId ?? resolveActiveScanRunId({ filters: filters || undefined });
  const { where, params } = resolveMetricsScope(id, filters);

  const jobsFound = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${where}`).get(params).c;
  const jobsMatched = db
    .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${where} AND score >= 50`)
    .get(params).c;
  const eligible = db
    .prepare(
      `SELECT COUNT(*) AS c FROM jobs WHERE ${where} AND auto_apply_eligible = 1 AND score >= 65`
    )
    .get(params).c;

  return { scanRunId: id, jobsFound, jobsMatched, eligible };
}

/** Per-source persisted counts reconciled from DB. */
export function computeSourceMetrics(scanRunId = null, filters = null) {
  const db = getDb();
  const id = scanRunId ?? resolveActiveScanRunId({ filters: filters || undefined });
  const { where, params } = resolveMetricsScope(id, filters);

  const rows = db
    .prepare(
      `SELECT source,
        COUNT(*) AS persisted,
        SUM(CASE WHEN score >= 50 THEN 1 ELSE 0 END) AS matched,
        SUM(CASE WHEN auto_apply_eligible = 1 AND score >= 65 THEN 1 ELSE 0 END) AS eligible
       FROM jobs WHERE ${where}
       GROUP BY source`
    )
    .all(params);

  return Object.fromEntries(
    rows.map((r) => [
      r.source,
      {
        persisted: r.persisted,
        matched: r.matched,
        eligible: r.eligible,
      },
    ])
  );
}

/** Merge orchestrator source status with actual persisted DB counts. */
export function reconcileSourceStatuses(sourceStatuses = [], scanRunId = null) {
  const persisted = computeSourceMetrics(scanRunId);
  return sourceStatuses.map((s) => {
    const db = persisted[s.name] || { persisted: 0, matched: 0, eligible: 0 };
    return {
      ...s,
      jobsFetched: s.jobsFetched ?? 0,
      jobsAfterFilters: s.jobsAfterFilters ?? s.jobsFetched ?? 0,
      jobsReturned: s.jobsFound ?? s.jobsReturned ?? 0,
      jobsPersisted: db.persisted,
      jobsFound: db.persisted > 0 ? db.persisted : (s.jobsFound ?? 0),
      jobsMatched: db.matched,
      jobsEligible: db.eligible,
    };
  });
}

/** Full scan session snapshot for UI — one API, one truth. */
export function getScanSessionSnapshot() {
  const db = getDb();
  const running = db
    .prepare(
      `SELECT * FROM scan_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1`
    )
    .get();

  if (running) {
    const metrics = computePersistedMetrics(running.id);
    const scanReport = safeJson(running.scan_report, null);
    const sourceStatuses = applyFailureDetailsToStatuses(
      reconcileSourceStatuses(safeJson(running.source_summary, []), running.id),
      scanReport
    );
    return {
      scanId: running.id,
      status: running.status,
      progress: running.progress ?? 0,
      message: running.message,
      startedAt: running.started_at,
      finishedAt: running.finished_at,
      searchFilters: safeJson(running.search_filters, null),
      ...metrics,
      jobsFetched: scanReport?.totalFetched ?? metrics.jobsFound,
      sourceMetrics: computeSourceMetrics(running.id),
      sourceStatuses,
      scanReport,
      failedSources: safeJson(running.failed_sources, []),
    };
  }

  const activeScanRunId = resolveActiveScanRunId();
  const run =
    activeScanRunId && db.prepare('SELECT * FROM scan_runs WHERE id = ?').get(activeScanRunId);

  if (!run) {
    const metrics = computePersistedMetrics(null);
    return {
      scanId: null,
      status: 'idle',
      ...metrics,
      sourceMetrics: computeSourceMetrics(null),
      scanReport: null,
    };
  }

  const metricsScanId = activeScanRunId || run.id;
  const scanReport = safeJson(run.scan_report, null);
  const metrics = computePersistedMetrics(metricsScanId);
  const sourceStatuses = applyFailureDetailsToStatuses(
    reconcileSourceStatuses(safeJson(run.source_summary, []), metricsScanId),
    scanReport
  );

  return {
    scanId: metricsScanId,
    status: run.status,
    progress: run.progress,
    message:
      run.status === 'completed'
        ? `Hunt complete — ${metrics.jobsFound} jobs found, ${metrics.eligible} eligible for auto-apply`
        : run.message,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    searchFilters: safeJson(run.search_filters, null),
    ...metrics,
    jobsFetched: scanReport?.totalFetched ?? metrics.jobsFound,
    sourceMetrics: computeSourceMetrics(metricsScanId),
    sourceStatuses,
    scanReport,
    failedSources: safeJson(run.failed_sources, []),
  };
}

export { countVisibleJobsForScan };
