import { v4 as uuidv4 } from 'uuid';
import { getDb, now } from '../db/database.js';
import { safeJson } from './sourceStore.js';
import { runSourceScan } from '../sources/scanOrchestrator.js';
import { dedupeJobs } from '../sources/dedupe.js';
import { filterJobs, loadMockJobs, withTimeout } from '../sources/utils.js';
import { getScanTimeoutMs } from '../sources/scanConfig.js';
import { jobToDbRow } from '../sources/types.js';
import { getLocationHintsForQuery } from './locationQuery.js';
import { enrichJobQuality } from '../sources/qualityScore.js';
import { clearSourceCache } from '../sources/sourceCache.js';
import { isMockMode } from '../sources/liveSearch.js';
import { buildJobWhereClause, buildJobWhereClauseOmitting, buildSortClause, resolveListScanRunId } from './jobQuery.js';
import {
  computeSearchIntentScore,
  hasStrongLocationMatch,
  scoreAndSortJobRows,
} from './searchIntentScore.js';
import {
  computeRejectionReasons,
  aggregateRejectionCounts,
} from './jobRejection.js';
import {
  computePersistedMetrics,
  reconcileSourceStatuses,
  getScanSessionSnapshot,
  resolveActiveScanRunId,
  getLatestScanRun,
  scanFiltersSignature,
  logScanScope,
  computeSourceMetrics,
} from './scanMetrics.js';
import { parseJobSources, getTargetsForSource } from '../sources/sourceConfig.js';
import { getMaxCompaniesPerSource } from '../sources/scanConfig.js';
import { getResumeScoringContext } from './resumeScoringContext.js';
import {
  ScanDiagnosticsCollector,
  runWithScanDiagnostics,
  attachDiagnosticsToScanReport,
  getScanDebugReport,
  enrichFailedSourceStatus,
  buildFailedSourcesReport,
} from './scanDiagnostics.js';

export { getScanDebugReport };

const PENDING_SOURCES = [
  { name: 'greenhouse', label: 'Greenhouse', status: 'pending', jobsFound: 0 },
  { name: 'lever', label: 'Lever', status: 'pending', jobsFound: 0 },
  { name: 'ashby', label: 'Ashby', status: 'pending', jobsFound: 0 },
  { name: 'smartrecruiters', label: 'SmartRecruiters', status: 'pending', jobsFound: 0 },
];

let scanState = {
  id: null,
  status: 'idle',
  phase: null,
  progress: 0,
  message: 'Ready',
  currentSource: null,
  jobsFound: 0,
  jobsMatched: 0,
  eligibleCount: 0,
  failedSources: [],
  sourceStatuses: [],
  logs: [],
  scanReport: null,
  partialResults: false,
  startedAt: null,
  finishedAt: null,
};

let scanAborted = false;
let pipelineRunning = false;
/** Serialize SQLite writes — parallel providers must not persist concurrently. */
let persistChain = Promise.resolve();

function pushLog(message) {
  const entry = { time: now(), message };
  scanState.logs = [...(scanState.logs || []), entry].slice(-80);
}

function formatMs(ms) {
  return `${ms}ms`;
}

function countVisibleJobs(scanRunId = null) {
  return computePersistedMetrics(scanRunId).jobsFound;
}

function syncMetricsFromDb(scanId) {
  const m = computePersistedMetrics(scanId);
  scanState.jobsFound = m.jobsFound;
  scanState.jobsMatched = m.jobsMatched;
  scanState.eligibleCount = m.eligible;
  return m;
}

export function getScanStatus() {
  if (scanState.status === 'running' || scanState.status === 'cancelled') {
    const m = syncMetricsFromDb(scanState.id);
    return {
      ...scanState,
      scanId: scanState.id,
      jobsFound: m.jobsFound,
      jobsMatched: m.jobsMatched,
      eligibleCount: m.eligible,
      sourceStatuses: reconcileSourceStatuses(scanState.sourceStatuses, scanState.id),
    };
  }

  const snapshot = getScanSessionSnapshot();
  if (!snapshot.scanId) return { ...scanState, ...snapshot, scanId: scanState.id ?? null };

  return {
    id: snapshot.scanId,
    scanId: snapshot.scanId,
    status: snapshot.status,
    phase: scanState.phase || (snapshot.status === 'completed' ? 'completed' : null),
    progress: snapshot.progress ?? 0,
    message: snapshot.message,
    currentSource: scanState.currentSource,
    jobsFound: snapshot.jobsFound,
    jobsMatched: snapshot.jobsMatched,
    eligibleCount: snapshot.eligible,
    failedSources: snapshot.failedSources,
    sourceStatuses: snapshot.sourceStatuses,
    scanReport: snapshot.scanReport,
    partialResults: scanState.partialResults,
    logs: scanState.logs,
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
  };
}

export function getScanMetrics() {
  return getScanSessionSnapshot();
}

export function isScanRunning() {
  return scanState.status === 'running';
}

export function stopScanJob() {
  if (scanState.status !== 'running') {
    return { stopped: false, message: 'No scan running' };
  }
  scanAborted = true;
  scanState.status = 'cancelled';
  scanState.phase = 'completed';
  scanState.message = 'Scan stopped by user';
  scanState.finishedAt = now();
  pushLog('Scan cancelled by user');
  getDb()
    .prepare(
      `UPDATE scan_runs SET status = 'cancelled', message = ?, finished_at = ? WHERE id = ?`
    )
    .run(scanState.message, scanState.finishedAt, scanState.id);
  return { stopped: true, status: getScanStatus() };
}

export function startScanJob(filters = {}, onProgress) {
  if (scanState.status === 'running' || pipelineRunning) {
    return { started: false, message: 'Scan already in progress' };
  }

  scanAborted = false;
  clearSourceCache();
  persistChain = Promise.resolve();
  const scanId = uuidv4();
  scanState = {
    id: scanId,
    status: 'running',
    phase: 'fetching',
    progress: 0,
    message: 'Starting job hunt…',
    currentSource: null,
    jobsFound: 0,
    jobsMatched: 0,
    eligibleCount: 0,
    failedSources: [],
    sourceStatuses: PENDING_SOURCES.map((s) => ({ ...s })),
    logs: [],
    scanReport: null,
    partialResults: false,
    startedAt: now(),
    finishedAt: null,
  };
  pushLog('Job hunt started');

  const db = getDb();
  const filterSig = scanFiltersSignature(filters);
  const activeSources = parseJobSources();
  const targetsBySource = Object.fromEntries(
    activeSources.map((source) => {
      const all = getTargetsForSource(source, { filters });
      const max = getMaxCompaniesPerSource();
      return [source, all.slice(0, max)];
    })
  );

  console.log(
    '[scan] start',
    JSON.stringify({
      scanRunId: scanId,
      keywords: filters.keywords || '',
      location: filters.location || '',
      searchFilters: filterSig,
      activeSources,
      targetsBySource,
      maxCompaniesPerSource: getMaxCompaniesPerSource(),
    })
  );

  db.prepare(
    `INSERT INTO scan_runs (id, status, progress, message, jobs_found, started_at, search_filters)
     VALUES (?, 'running', 0, ?, 0, ?, ?)`
  ).run(scanId, scanState.message, scanState.startedAt, filterSig);

  void runAdapterPipeline(scanId, filters, onProgress, { activeSources, targetsBySource });
  return { started: true, scanId };
}

function persistJobs(jobs, scanRunId, label = 'save') {
  console.log(`[scan] persistJobs START label=${label} count=${jobs.length} scanRunId=${scanRunId}`);
  const saveStart = Date.now();
  const db = getDb();
  const insertJob = db.prepare(
    `INSERT INTO jobs (id, company, title, url, source, score, location, normalized_location, remote_type,
      employment_type, experience_level, visa_fit, auto_apply_eligible, pipeline_status,
      data_source, description, quality_checks, scan_run_id, salary_min, salary_max, date_posted, created_at, updated_at)
     VALUES (@id, @company, @title, @url, @source, @score, @location, @normalized_location, @remote_type,
      @employment_type, @experience_level, @visa_fit, @auto_apply_eligible, @pipeline_status,
      @data_source, @description, @quality_checks, @scan_run_id, @salary_min, @salary_max, @date_posted, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
      score = excluded.score,
      visa_fit = excluded.visa_fit,
      auto_apply_eligible = excluded.auto_apply_eligible,
      data_source = excluded.data_source,
      normalized_location = COALESCE(excluded.normalized_location, normalized_location),
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE description END,
      quality_checks = COALESCE(excluded.quality_checks, quality_checks),
      scan_run_id = excluded.scan_run_id,
      updated_at = excluded.updated_at`
  );
  const insertApp = db.prepare(
    `INSERT INTO applications (id, job_id, pipeline_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO NOTHING`
  );

  const ts = now();
  let matched = 0;
  let eligible = 0;
  let inserted = 0;
  let updated = 0;
  const existsStmt = db.prepare('SELECT id FROM jobs WHERE id = ?');
  const tx = db.transaction((items) => {
    for (const job of items) {
      const row = jobToDbRow(job, ts);
      row.scan_run_id = scanRunId || row.scan_run_id || null;
      const qcPayload = {
        ...(job.qualityChecks || {}),
        matchBreakdown: job.matchBreakdown || null,
        matchedSkills: job.matchedSkills || [],
        missingSkills: job.missingSkills || [],
        scoreSkillSource: job.scoreSkillSource || null,
      };
      row.quality_checks = JSON.stringify(qcPayload);
      if (row.score >= 50) matched += 1;
      if (row.auto_apply_eligible && row.score >= 65) eligible += 1;
      const exists = existsStmt.get(row.id);
      insertJob.run(row);
      if (exists) updated += 1;
      else inserted += 1;
      insertApp.run(`app_${row.id}`, row.id, row.pipeline_status, ts, ts);
    }
  });
  tx(jobs);
  const saveMs = Date.now() - saveStart;
  const tableTotal = db.prepare('SELECT COUNT(*) AS c FROM jobs').get().c;
  pushLog(
    `DB ${label}: received=${jobs.length} inserted=${inserted} updated=${updated} tableTotal=${tableTotal} (${formatMs(saveMs)})`
  );
  console.log(
    `[scan] persistJobs END label=${label} count=${jobs.length} inserted=${inserted} updated=${updated} duration=${saveMs}ms`
  );
  return { count: jobs.length, inserted, updated, matched, eligible, saveMs, tableTotal };
}

async function persistJobsQueued(jobs, scanRunId, label = 'save') {
  persistChain = persistChain.then(() => persistJobs(jobs, scanRunId, label));
  return persistChain;
}

function markScanComplete(scanId, filters, { result, timedOut, pipelineError, onProgress }) {
  console.log('[scan] markScanComplete START', scanId);
  try {
    const aborted = scanAborted || result?.aborted;
    const m = syncMetricsFromDb(scanId);
    const reconciledSources = reconcileSourceStatuses(
      result?.sourceStatuses || scanState.sourceStatuses,
      scanId
    );
    const failedSources = result?.failedSources || scanState.failedSources || [];
    const enrichedSources = (result?.sourceStatuses || reconciledSources).map((s) =>
      enrichFailedSourceStatus(s, result?.diagnostics)
    );
    const failedSourceDetails = buildFailedSourcesReport(result?.diagnostics, failedSources);

    if (aborted && scanState.status === 'cancelled') {
      scanState.finishedAt = scanState.finishedAt || now();
      scanState.currentSource = null;
      pushLog('Scan pipeline finished (cancelled)');
    } else {
      scanState.progress = 100;
      scanState.status = 'completed';
      scanState.phase = 'completed';
      scanState.jobsFound = m.jobsFound;
      scanState.jobsMatched = m.jobsMatched;
      scanState.eligibleCount = m.eligible;
      scanState.sourceStatuses = enrichedSources;
      scanState.failedSources = failedSources;
      scanState.scanReport = attachDiagnosticsToScanReport(
        result?.scanReport || scanState.scanReport || null,
        result?.diagnostics,
        failedSources
      );
      scanState.partialResults = false;
      scanState.finishedAt = now();
      scanState.currentSource = null;

      const failureNote =
        failedSources.length > 0 ? ` (${failedSources.length} source(s) failed)` : '';
      const timeoutNote = timedOut ? ' (global timeout — partial results)' : '';
      const errorNote = pipelineError && !timedOut ? ` (${pipelineError.message})` : '';

      scanState.message =
        m.jobsFound > 0
          ? `Hunt complete — ${m.jobsFound} jobs found, ${m.eligible} eligible for auto-apply${failureNote}${timeoutNote}`
          : `Hunt complete — no jobs matched your filters${failureNote}${timeoutNote}${errorNote}`;

      pushLog(scanState.message);

      getDb()
        .prepare(
          `UPDATE scan_runs SET status = 'completed', progress = 100, message = ?, jobs_found = ?,
           jobs_matched = ?, eligible_count = ?, source_summary = ?, scan_report = ?, failed_sources = ?,
           finished_at = ? WHERE id = ?`
        )
        .run(
          scanState.message,
          m.jobsFound,
          m.jobsMatched,
          m.eligible,
          JSON.stringify(enrichedSources),
          JSON.stringify(scanState.scanReport || attachDiagnosticsToScanReport(result?.scanReport, result?.diagnostics, failedSources) || {}),
          JSON.stringify(failedSources),
          scanState.finishedAt,
          scanId
        );
    }

    const persistedBySource = computeSourceMetrics(scanId);
    console.log(
      '[scan] complete',
      JSON.stringify({
        scanRunId: scanId,
        keywords: filters.keywords || '',
        location: filters.location || '',
        searchFilters: scanFiltersSignature(filters),
        jobsFound: m.jobsFound,
        jobsMatched: m.jobsMatched,
        eligible: m.eligible,
        timedOut: Boolean(timedOut),
        aborted: Boolean(aborted),
        failedSources,
        failedSourceDetails,
        persistedBySource,
        sourceStatuses: enrichedSources.map((s) => ({
          name: s.name,
          status: s.status,
          fetched: s.jobsFetched,
          persisted: s.jobsPersisted,
          ...(s.status === 'failed'
            ? {
                error: s.error,
                stack: s.stack,
                firstFailedTarget: s.firstFailedTarget,
                requestUrl: s.requestUrl,
                httpStatus: s.httpStatus,
                httpBody: s.httpBody,
              }
            : {}),
        })),
      })
    );

    onProgress?.({ ...scanState, jobsFound: m.jobsFound, jobsMatched: m.jobsMatched, eligibleCount: m.eligible });
  } catch (err) {
    console.error('[scan] markScanComplete error:', err.message);
    scanState.status = 'completed';
    scanState.phase = 'completed';
    scanState.message = `Hunt complete — ${err.message}`;
    scanState.finishedAt = now();
    getDb()
      .prepare(
        `UPDATE scan_runs SET status = 'completed', message = ?, finished_at = ? WHERE id = ?`
      )
      .run(scanState.message, scanState.finishedAt, scanId);
    console.log('[scan] complete', JSON.stringify({ scanRunId: scanId, error: err.message }));
    onProgress?.({ ...scanState });
  } finally {
    console.log('[scan] markScanComplete END', scanId);
  }
}

async function runAdapterPipeline(scanId, filters, onProgress, scanMeta = {}) {
  if (pipelineRunning) {
    pushLog('Scan pipeline already running — skipped duplicate start');
    return;
  }
  pipelineRunning = true;
  const scoringCtx = getResumeScoringContext(filters.keywords, filters.location);
  const matchThreshold = Number(filters.minScore || 50);
  const enrichOpts = {
    resumeKeywords: scoringCtx.skills,
    skillSource: scoringCtx.skillSource,
    preferredLocation: scoringCtx.preferredLocation,
    keywords: filters.keywords,
    location: filters.location,
  };

  const diagnostics = new ScanDiagnosticsCollector(scanId, {
    filters,
    activeSources: scanMeta.activeSources || parseJobSources(),
    targetsBySource: scanMeta.targetsBySource || {},
    matchThreshold,
  });

  const syncProgress = (patch) => {
    Object.assign(scanState, patch);
    if (patch.logs) scanState.logs = patch.logs;
    if (patch.sourceStatuses) {
      scanState.sourceStatuses = reconcileSourceStatuses(patch.sourceStatuses, scanId);
    }
    const m = syncMetricsFromDb(scanId);
    getDb()
      .prepare(
        `UPDATE scan_runs SET progress = ?, message = ?, jobs_found = ?, jobs_matched = ?, eligible_count = ? WHERE id = ?`
      )
      .run(
        scanState.progress ?? 0,
        scanState.message ?? '',
        m.jobsFound,
        m.jobsMatched,
        m.eligible,
        scanId
      );
    onProgress?.({
      ...scanState,
      jobsFound: m.jobsFound,
      jobsMatched: m.jobsMatched,
      eligibleCount: m.eligible,
    });
  };

  let scanResult = null;
  let timedOut = false;
  let pipelineError = null;

  try {
    scanResult = await runWithScanDiagnostics(diagnostics, () =>
      withTimeout(
        runSourceScan({
          filters,
          enrichOpts,
          matchThreshold,
          isAborted: () => scanAborted,
          onProgress: syncProgress,
          diagnostics,
          onJobsReady: async (jobs, meta = {}) => {
            if (!jobs.length || scanAborted) return;
            const label = meta.source ? `persist/${meta.source}` : 'persist';
            const saveResult = await persistJobsQueued(jobs, scanId, label);
            if (meta.source && meta.source !== 'dedupe') {
              diagnostics.recordPersistedBySource(meta.source, saveResult.count);
            }
            const persistedBySource = computeSourceMetrics(scanId);
            for (const [source, metrics] of Object.entries(persistedBySource)) {
              diagnostics.recordPersistedBySource(source, metrics.persisted);
            }
            scanState.partialResults = true;
            syncProgress({
              partialResults: true,
              message: meta.partial
                ? `${meta.source || 'Results'} ready — ${saveResult.count} saved (${saveResult.inserted} new, ${saveResult.updated} updated)`
                : scanState.message,
            });
          },
          onEnrichmentBatch: async (batch) => {
            if (!batch.length || scanAborted) return;
            const saveResult = await persistJobsQueued(batch, scanId, 'enrich');
            const persistedBySource = computeSourceMetrics(scanId);
            for (const [source, metrics] of Object.entries(persistedBySource)) {
              diagnostics.recordPersistedBySource(source, metrics.persisted);
            }
            syncProgress({
              message: `Enriched ${batch.length} jobs — DB total ${saveResult.tableTotal}`,
            });
          },
          onPersistStats: (info) => {
            pushLog(`Persist checkpoint: ${info.count} from ${info.source} (running total ${info.persisted})`);
          },
        }),
        getScanTimeoutMs(),
        'scan pipeline'
      )
    );
  } catch (err) {
    pipelineError = err;
    if (String(err.message || '').includes('timed out')) {
      timedOut = true;
      console.log(`[scan] global timeout after ${getScanTimeoutMs()}ms — completing with partial results`);
      pushLog(`Scan global timeout (${getScanTimeoutMs()}ms) — saving partial results`);
    } else {
      console.error('[scan] pipeline error:', err.message);
      pushLog(`Scan error: ${err.message}`);
    }
  } finally {
    await persistChain.catch(() => {});
    const finalResult = scanResult
      ? { ...scanResult, diagnostics: scanResult.diagnostics || diagnostics }
      : { diagnostics, sourceStatuses: scanState.sourceStatuses, failedSources: scanState.failedSources, scanReport: null };
    markScanComplete(scanId, filters, {
      result: finalResult,
      timedOut,
      pipelineError,
      onProgress,
    });
    pipelineRunning = false;
  }
}

/** Fast seed from mock_jobs.json (no per-source delays). */
export function seedFromMock(filters = {}) {
  const deduped = dedupeJobs(filterJobs(loadMockJobs(), filters));
  const scoringCtx = getResumeScoringContext(filters.keywords, filters.location);
  const opts = {
    resumeKeywords: scoringCtx.skills,
    skillSource: scoringCtx.skillSource,
    preferredLocation: scoringCtx.preferredLocation,
    keywords: filters.keywords,
    location: filters.location,
  };
  const enriched = deduped.map((job) => enrichJobQuality({ ...job, dataSource: 'mock' }, opts));
  return persistJobs(enriched, null);
}

const APPLY_STATUSES = new Set([
  'auto_applied',
  'applied',
  'waiting',
  'technical_interview',
  'offer',
  'rejected',
]);

function hasCompletedAutoApplyAttempt(jobId) {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM auto_apply_attempts
         WHERE job_id = ? AND status IN ('paused', 'auto_applied', 'completed')`
      )
      .get(jobId)
  );
}

function resolvePipelineStatus(row) {
  if (row.data_source === 'mock' && APPLY_STATUSES.has(row.pipeline_status)) {
    return row.auto_apply_eligible && row.score >= 65 ? 'ready_to_apply' : 'matched';
  }
  if (
    (row.pipeline_status === 'auto_applied' || row.pipeline_status === 'applied') &&
    !hasCompletedAutoApplyAttempt(row.id)
  ) {
    return row.auto_apply_eligible && row.score >= 65 ? 'ready_to_apply' : 'matched';
  }
  return row.pipeline_status;
}

/** Remove mock jobs and reset scan history. Keeps resume and user settings. */
export function clearMockData() {
  const db = getDb();
  const mockIds = db
    .prepare(
      `SELECT id FROM jobs WHERE id LIKE 'mock-%' OR COALESCE(data_source, '') = 'mock'`
    )
    .all()
    .map((r) => r.id);

  let deleted = 0;
  const tx = db.transaction(() => {
    if (mockIds.length > 0) {
      const ph = mockIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM auto_apply_attempts WHERE job_id IN (${ph})`).run(...mockIds);
      db.prepare(`DELETE FROM manual_review_items WHERE job_id IN (${ph})`).run(...mockIds);
      db.prepare(`DELETE FROM applications WHERE job_id IN (${ph})`).run(...mockIds);
      deleted = db.prepare(`DELETE FROM jobs WHERE id IN (${ph})`).run(...mockIds).changes;
    }
    db.prepare(
      `UPDATE jobs SET pipeline_status = CASE
         WHEN auto_apply_eligible = 1 AND score >= 65 THEN 'ready_to_apply'
         WHEN score >= 50 THEN 'matched'
         ELSE 'found'
       END
       WHERE pipeline_status IN ('auto_applied', 'applied')
       AND id NOT IN (SELECT job_id FROM auto_apply_attempts WHERE status IN ('paused', 'auto_applied', 'completed'))`
    ).run();
    db.prepare('DELETE FROM scan_runs').run();
    clearSourceCache();
  });
  tx();
  return { deleted, mockMode: isMockMode() };
}

export { isMockMode };

function countJobsWhere(db, whereSql, params) {
  return db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${whereSql}`).get(params).c;
}

function shouldRankBySearchIntent(filters = {}) {
  if (filters.savedOnly === 'true') return false;
  return Boolean(resolveListScanRunId(filters));
}

/** Pipeline counts for active scan dataset + current filters. */
export function computeFilterPipeline(db, filters = {}, tab = 'all', { rankByIntent = false } = {}) {
  if (rankByIntent) {
    const scanOnly = buildJobWhereClauseOmitting(filters, tab, { omitKeywords: true, omitLocation: true });
    const totalJobs = countJobsWhere(db, scanOnly.whereSql, scanOnly.params);
    return {
      totalJobs,
      afterKeywordFilter: totalJobs,
      afterLocationFilter: totalJobs,
      renderedJobs: totalJobs,
    };
  }

  const scanOnly = buildJobWhereClauseOmitting(filters, tab, { omitKeywords: true, omitLocation: true });
  const afterKeyword = buildJobWhereClauseOmitting(filters, tab, { omitLocation: true });
  const afterLocation = buildJobWhereClause(filters, tab);

  const totalJobs = countJobsWhere(db, scanOnly.whereSql, scanOnly.params);
  const afterKeywordFilter = countJobsWhere(db, afterKeyword.whereSql, afterKeyword.params);
  const afterLocationFilter = countJobsWhere(db, afterLocation.whereSql, afterLocation.params);

  return {
    totalJobs,
    afterKeywordFilter,
    afterLocationFilter,
    renderedJobs: afterLocationFilter,
  };
}

function logFilterPipeline(label, pipeline, filters = {}) {
  const { activeScanRunId } = logScanScope(label, filters);
  console.log(
    `[jobs] ${label} counts: activeScanRunId=${activeScanRunId ?? 'none'} totalJobs=${pipeline.totalJobs} afterKeywordFilter=${pipeline.afterKeywordFilter} afterLocationFilter=${pipeline.afterLocationFilter} renderedJobs=${pipeline.renderedJobs}`
  );
}

/** Drop UI filters on All Jobs when they hide rows within the same scan — never across scans. */
function applyAllTabFilterRecovery(db, filters, tab, pipeline) {
  const scanRunId = resolveListScanRunId(filters);
  if (
    !scanRunId ||
    tab !== 'all' ||
    pipeline.renderedJobs > 0 ||
    pipeline.totalJobs === 0
  ) {
    return { effectiveFilters: filters, pipeline, locationFallback: null, keywordFallback: false };
  }

  let effectiveFilters = { ...filters, scanRunId };
  let locationFallback = null;
  let keywordFallback = false;

  if (effectiveFilters.location) {
    const dropped = effectiveFilters.location;
    delete effectiveFilters.location;
    effectiveFilters.scanRunId = scanRunId;
    pipeline = computeFilterPipeline(db, effectiveFilters, tab);
    locationFallback = { active: true, query: dropped };
  }

  if (pipeline.renderedJobs === 0 && effectiveFilters.keywords) {
    delete effectiveFilters.keywords;
    effectiveFilters.scanRunId = scanRunId;
    pipeline = computeFilterPipeline(db, effectiveFilters, tab);
    keywordFallback = true;
  }

  return { effectiveFilters, pipeline, locationFallback, keywordFallback };
}

function countPersistedForScan(db, scanRunId) {
  if (!scanRunId) return 0;
  return countJobsWhere(
    db,
    'COALESCE(is_hidden, 0) = 0 AND scan_run_id = @scanRunId',
    { scanRunId }
  );
}

function emptyListJobsResponse({ page = 1, limit = 25, tab = 'all', sortBy = 'score', sortOrder = 'desc', reason = null } = {}) {
  if (reason) {
    console.error(`[jobs] returning empty results: ${reason}`);
  }
  return {
    jobs: [],
    page,
    limit,
    totalJobs: 0,
    totalPages: 1,
    locationHints: null,
    locationFallback: null,
    filterPipeline: {
      totalJobs: 0,
      afterKeywordFilter: 0,
      afterLocationFilter: 0,
      renderedJobs: 0,
    },
    data: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalJobs: 0,
      totalPages: 1,
      hasMore: false,
      returned: 0,
    },
    tab,
    sortBy,
    sortOrder,
  };
}

function enforceScanResultIntegrity(db, scanRunId, visibleTotal) {
  const persistedRowsForScan = countPersistedForScan(db, scanRunId);
  if (persistedRowsForScan === 0 && visibleTotal > 0) {
    console.error(
      `[jobs] ERROR visibleResults=${visibleTotal} > persistedRowsForScan=0 scanRunId=${scanRunId}`
    );
    return { ok: false, persistedRowsForScan };
  }
  if (visibleTotal > persistedRowsForScan) {
    console.error(
      `[jobs] ERROR visibleResults=${visibleTotal} > persistedRowsForScan=${persistedRowsForScan} scanRunId=${scanRunId}`
    );
    return { ok: false, persistedRowsForScan };
  }
  return { ok: true, persistedRowsForScan };
}

export function getJobsListDebug(filters = {}, tab = 'all') {
  const db = getDb();
  const activeScanRunId = resolveListScanRunId(filters);
  const latestScanRunId = getLatestScanRun()?.id ?? null;
  const persistedRowsForScan = countPersistedForScan(db, activeScanRunId);

  let pipeline = computeFilterPipeline(db, filters, tab);
  const recovered = applyAllTabFilterRecovery(db, filters, tab, pipeline);
  pipeline = recovered.pipeline;

  const preview = listJobs({ page: 1, limit: 25, filters, tab, sortBy: 'score', sortOrder: 'desc' });

  return {
    activeScanRunId,
    latestScanRunId,
    persistedRowsForScan,
    rowsAfterFilters: pipeline.afterLocationFilter,
    returnedRows: preview.pagination.returned,
    totalRows: preview.pagination.total,
    filterPipeline: pipeline,
    locationFallback: preview.locationFallback,
    visibleJobsTotal: db.prepare('SELECT COUNT(*) AS c FROM jobs WHERE COALESCE(is_hidden, 0) = 0').get().c,
  };
}

export function listJobs({ page = 1, limit = 25, filters = {}, tab = 'all', sortBy = 'score', sortOrder = 'desc' }) {
  const db = getDb();
  const scanRunId = resolveListScanRunId(filters);
  const rankByIntent = shouldRankBySearchIntent(filters);

  if (!scanRunId && filters.savedOnly !== 'true') {
    logFilterPipeline('filter pipeline', {
      totalJobs: 0,
      afterKeywordFilter: 0,
      afterLocationFilter: 0,
      renderedJobs: 0,
    }, filters);
    return emptyListJobsResponse({
      page,
      limit,
      tab,
      sortBy,
      sortOrder,
      reason: 'no active scanRunId for current search filters',
    });
  }

  let effectiveFilters = { ...filters };
  if (scanRunId) effectiveFilters.scanRunId = scanRunId;

  let pipeline = computeFilterPipeline(db, effectiveFilters, tab, { rankByIntent });
  logFilterPipeline('filter pipeline', pipeline, effectiveFilters);

  let locationFallback = null;
  if (rankByIntent) {
    effectiveFilters = { ...effectiveFilters };
    delete effectiveFilters.keywords;
    delete effectiveFilters.location;
  } else {
    const recovered = applyAllTabFilterRecovery(db, effectiveFilters, tab, pipeline);
    effectiveFilters = recovered.effectiveFilters;
    pipeline = recovered.pipeline;
    locationFallback = recovered.locationFallback;
    if (recovered.locationFallback || recovered.keywordFallback) {
      logFilterPipeline('filter recovery', pipeline, effectiveFilters);
    }
  }

  const persistedRowsForScan = countPersistedForScan(db, scanRunId);
  if (persistedRowsForScan === 0) {
    logFilterPipeline('response', { ...pipeline, renderedJobs: 0 }, effectiveFilters);
    return emptyListJobsResponse({ page, limit, tab, sortBy, sortOrder });
  }

  const { whereSql, params, threshold } = buildJobWhereClause(effectiveFilters, tab);

  if (rankByIntent) {
    const allRows = db.prepare(`SELECT * FROM jobs WHERE ${whereSql}`).all(params);
    let total = allRows.length;
    const integrity = enforceScanResultIntegrity(db, scanRunId, total);
    if (!integrity.ok) {
      return emptyListJobsResponse({
        page,
        limit,
        tab,
        sortBy,
        sortOrder,
        reason: `integrity check failed (visible=${total}, persisted=${integrity.persistedRowsForScan})`,
      });
    }

    if (filters.location && !hasStrongLocationMatch(allRows, filters.location)) {
      locationFallback = { active: true, query: filters.location };
    }

    // [DIAG-3] titles before ranking
    console.log('[DIAG-3] listJobs rankByIntent input', JSON.stringify({ keywords: filters.keywords, location: filters.location, totalRows: allRows.length, first20titles: allRows.slice(0, 20).map(r => r.title) }));
    const sorted = scoreAndSortJobRows(allRows, filters, sortBy, sortOrder);
    // [DIAG-5] titles after ranking
    console.log('[DIAG-5] listJobs ranked output first20', JSON.stringify(sorted.slice(0, 20).map(r => ({ title: r.row.title, searchIntentScore: r.searchIntentScore }))));
    total = Math.min(sorted.length, persistedRowsForScan);
    const offset = (page - 1) * limit;
    const pageScored = sorted.slice(offset, offset + limit);
    const data = pageScored.map(({ row, searchIntentScore, searchIntentReasons }) => ({
      ...normalizeJob(row, filters, threshold),
      searchIntentScore,
      searchIntentReasons,
    }));

    pipeline.renderedJobs = total;
    logFilterPipeline('response', pipeline, filters);

    const totalPages = Math.ceil(total / limit) || 1;
    return {
      jobs: data,
      page,
      limit,
      totalJobs: total,
      totalPages,
      locationHints: null,
      locationFallback,
      filterPipeline: pipeline,
      data,
      pagination: {
        page,
        limit,
        total,
        totalJobs: total,
        totalPages,
        hasMore: page < totalPages,
        returned: data.length,
      },
      tab,
      sortBy,
      sortOrder,
      rankByIntent: true,
    };
  }

  const orderSql = buildSortClause(sortBy, sortOrder);

  let total = db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${whereSql}`).get(params).c;
  const integrity = enforceScanResultIntegrity(db, scanRunId, total);
  if (!integrity.ok) {
    return emptyListJobsResponse({
      page,
      limit,
      tab,
      sortBy,
      sortOrder,
      reason: `integrity check failed (visible=${total}, persisted=${integrity.persistedRowsForScan})`,
    });
  }

  const offset = (page - 1) * limit;
  const rows = db
    .prepare(`SELECT * FROM jobs WHERE ${whereSql} ORDER BY ${orderSql} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });

  const data = rows.map((row) => normalizeJob(row, effectiveFilters, threshold));

  total = Math.min(total, persistedRowsForScan);
  pipeline.renderedJobs = total;
  logFilterPipeline('response', pipeline, effectiveFilters);

  const totalPages = Math.ceil(total / limit) || 1;
  const locationHints =
    !locationFallback && filters.location && total === 0
      ? getLocationHintsForQuery(filters.location, filters)
      : null;

  return {
    jobs: data,
    page,
    limit,
    totalJobs: total,
    totalPages,
    locationHints,
    locationFallback,
    filterPipeline: pipeline,
    data,
    pagination: {
      page,
      limit,
      total,
      totalJobs: total,
      totalPages,
      hasMore: page < totalPages,
      returned: data.length,
    },
    tab,
    sortBy,
    sortOrder,
  };
}

export function getJobFunnelStats(filters = {}) {
  logScanScope('funnel', filters);
  const snapshot = getScanSessionSnapshot();
  const db = getDb();
  const threshold = Number(filters.minScore || 50);
  const rankByIntent = shouldRankBySearchIntent(filters);

  let effectiveFilters = { ...filters };
  let pipeline = computeFilterPipeline(db, effectiveFilters, 'all', { rankByIntent });
  let locationFallback = null;

  if (rankByIntent) {
    effectiveFilters = { ...effectiveFilters };
    delete effectiveFilters.keywords;
    delete effectiveFilters.location;
  } else {
    const recovered = applyAllTabFilterRecovery(db, effectiveFilters, 'all', pipeline);
    effectiveFilters = recovered.effectiveFilters;
    pipeline = recovered.pipeline;
    locationFallback = recovered.locationFallback;
  }

  const { whereSql: baseWhere, params: baseParams } = buildJobWhereClause(effectiveFilters, 'all');

  const afterFilters = db
    .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${baseWhere}`)
    .get(baseParams).c;

  const afterMatch = db
    .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${baseWhere} AND score >= @minScore`)
    .get({ ...baseParams, minScore: threshold }).c;

  const autoApplyEligible = db
    .prepare(
      `SELECT COUNT(*) AS c FROM jobs WHERE ${baseWhere} AND auto_apply_eligible = 1 AND score >= 65`
    )
    .get(baseParams).c;

  const allRows = db.prepare(`SELECT * FROM jobs WHERE ${baseWhere}`).all(baseParams);
  if (rankByIntent && filters.location && !hasStrongLocationMatch(allRows, filters.location)) {
    locationFallback = { active: true, query: filters.location };
  }
  const rejectionCounts = aggregateRejectionCounts(
    allRows.map((row) => normalizeJob(row, filters, threshold)),
    filters,
    threshold
  );

  const recClause = buildJobWhereClause(effectiveFilters, 'recommended');
  const recommended = db
    .prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${recClause.whereSql}`)
    .get(recClause.params).c;

  const recommendedPipeline = computeFilterPipeline(db, effectiveFilters, 'recommended');

  return {
    scanId: snapshot.scanId,
    fetched: snapshot.scanReport?.totalFetched ?? snapshot.jobsFound,
    afterFilters,
    jobsFound: afterFilters,
    jobsMatched: afterMatch,
    eligible: autoApplyEligible,
    afterMatch,
    autoApplyEligible,
    recommended,
    threshold,
    rejectionCounts,
    duplicatesRemoved: snapshot.scanReport?.duplicatesRemoved ?? 0,
    filterPipeline: pipeline,
    locationFallback,
    recommendedCount: recommendedPipeline.renderedJobs,
  };
}

export function getJobById(id, filters = {}, threshold = 50) {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? getJobDetail(row, filters, threshold) : null;
}

function extractSkills(text = '', keywords = '') {
  const skillTerms = [
    'python', 'java', 'javascript', 'typescript', 'react', 'node', 'aws', 'sql',
    'kubernetes', 'docker', 'go', 'rust', 'c++', 'machine learning', 'ai',
  ];
  const lower = text.toLowerCase();
  const found = skillTerms.filter((s) => lower.includes(s));
  if (keywords) {
    const kw = keywords.toLowerCase().split(/\s+/).filter(Boolean);
    for (const k of kw) {
      if (lower.includes(k) && !found.includes(k)) found.push(k);
    }
  }
  return found.slice(0, 12);
}

function getJobDetail(row, filters = {}, threshold = 50) {
  const job = normalizeJob(row, filters, threshold);
  const qc = row.quality_checks ? safeJson(row.quality_checks, {}) : {};
  const { matchBreakdown, matchedSkills, missingSkills, scoreSkillSource, ...checks } = qc;
  job.quality_checks = checks;
  job.match_breakdown = Array.isArray(matchBreakdown) && matchBreakdown[0]?.label
    ? matchBreakdown
    : [
      { label: 'Apply URL', points: checks.hasApplyUrl ? 20 : 0, max: 20 },
      { label: 'Description', points: checks.hasDescription ? 20 : 0, max: 20 },
      { label: 'Location', points: checks.hasLocation ? 15 : 0, max: 15 },
      { label: 'Company', points: checks.hasCompany ? 15 : 0, max: 15 },
      { label: 'Title', points: checks.hasTitle ? 10 : 0, max: 10 },
      { label: 'Recent post', points: checks.recentPostedDate ? 10 : 0, max: 10 },
      { label: 'Not duplicate', points: checks.notDuplicate ? 5 : 0, max: 5 },
      { label: 'Active listing', points: checks.notClosed ? 5 : 0, max: 5 },
    ];
  job.required_skills =
    (Array.isArray(matchedSkills) && matchedSkills.length ? matchedSkills : null) ||
    extractSkills(row.description || '', filters.keywords || '');
  job.missing_skills = Array.isArray(missingSkills) ? missingSkills : [];
  job.score_skill_source = scoreSkillSource || null;
  job.visa_indicators = {
    fit: job.visa_fit,
    sponsorshipMentioned: ['positive', 'cpt_friendly', 'sponsorship_friendly'].includes(job.visa_fit),
    cptMentioned: job.visa_fit?.includes('cpt') ?? false,
  };
  job.is_saved = Boolean(row.is_saved);
  job.is_hidden = Boolean(row.is_hidden);
  return job;
}

export function updateJobRecord(jobId, payload = {}) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  const ts = now();
  const statusMap = {
    applied: 'applied',
    interview: 'technical_interview',
    rejected: 'rejected',
  };

  if (payload.action === 'save') {
    db.prepare('UPDATE jobs SET is_saved = 1, updated_at = ? WHERE id = ?').run(ts, jobId);
  } else if (payload.action === 'hide') {
    db.prepare('UPDATE jobs SET is_hidden = 1, updated_at = ? WHERE id = ?').run(ts, jobId);
  } else if (payload.action === 'unsave') {
    db.prepare('UPDATE jobs SET is_saved = 0, updated_at = ? WHERE id = ?').run(ts, jobId);
  } else if (statusMap[payload.action]) {
    const status = statusMap[payload.action];
    db.prepare('UPDATE jobs SET pipeline_status = ?, updated_at = ? WHERE id = ?').run(status, ts, jobId);
    db.prepare('UPDATE applications SET pipeline_status = ?, updated_at = ? WHERE job_id = ?').run(
      status,
      ts,
      jobId
    );
  }

  if (payload.notes !== undefined) {
    db.prepare('UPDATE jobs SET notes = ?, updated_at = ? WHERE id = ?').run(
      String(payload.notes),
      ts,
      jobId
    );
  }

  return getJobById(jobId);
}

function normalizeJob(row, filters = {}, threshold = 50) {
  const pipeline_status = resolvePipelineStatus(row);
  const job = {
    ...row,
    pipeline_status,
    auto_apply_eligible: Boolean(row.auto_apply_eligible),
    is_saved: Boolean(row.is_saved),
    is_hidden: Boolean(row.is_hidden),
    match_score: row.score,
    apply_url: row.url,
    role: row.title,
    data_source: row.data_source || (String(row.id).startsWith('mock-') ? 'mock' : 'live'),
  };
  job.rejection_reasons = computeRejectionReasons(job, filters, threshold);
  job.is_recommended = job.rejection_reasons.length === 0;
  return job;
}

export function countEligibleJobs() {
  return getDb()
    .prepare('SELECT COUNT(*) AS c FROM jobs WHERE auto_apply_eligible = 1 AND score >= 65')
    .get().c;
}

export function getHuntKpis(filters = {}) {
  logScanScope('kpi', filters);
  const scanRunId = resolveListScanRunId(filters);
  const m = computePersistedMetrics(scanRunId || null, scanRunId ? undefined : filters);
  const db = getDb();
  const manualOpen = db.prepare("SELECT COUNT(*) AS c FROM manual_review_items WHERE status = 'open'").get().c;
  const scope = m.scanRunId
    ? 'COALESCE(is_hidden, 0) = 0 AND scan_run_id = @scanRunId'
    : '1=0';
  const scopeParams = m.scanRunId ? { scanRunId: m.scanRunId } : {};
  return {
    jobsFound: m.jobsFound,
    matched: m.jobsMatched,
    eligible: m.eligible,
    saved: db.prepare(`SELECT COUNT(*) AS c FROM jobs WHERE ${scope} AND is_saved = 1`).get(scopeParams).c,
    applied: db.prepare(
      "SELECT COUNT(*) AS c FROM jobs WHERE pipeline_status IN ('applied', 'auto_applied')"
    ).get().c,
    manualPending:
      db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE pipeline_status = 'manual_pending'").get().c + manualOpen,
  };
}

export function moveJobToManual(jobId, reason = 'unknown_field', details = '') {
  const job = getJobById(jobId);
  if (!job) return null;
  const ts = now();
  getDb()
    .prepare(
      'INSERT INTO manual_review_items (job_id, reason, details, status, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(jobId, reason, details, 'open', ts);
  getDb()
    .prepare("UPDATE jobs SET pipeline_status = 'manual_pending', updated_at = ? WHERE id = ?")
    .run(ts, jobId);
  return { success: true, jobId, reason };
}

export function skipJob(jobId) {
  const ts = now();
  getDb()
    .prepare("UPDATE jobs SET pipeline_status = 'skipped', updated_at = ? WHERE id = ?")
    .run(ts, jobId);
  return { success: true, jobId };
}

function escapeCsv(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportJobsCsv(filters = {}) {
  const { data } = listJobs({ page: 1, limit: 10000, filters, tab: 'all' });
  const headers = [
    'title',
    'company',
    'location',
    'source',
    'match_score',
    'visa_fit',
    'apply_url',
    'posted_date',
    'status',
  ];
  const rows = data.map((job) =>
    [
      job.title,
      job.company,
      job.location,
      job.source,
      job.score,
      job.visa_fit,
      job.url || job.apply_url,
      job.date_posted,
      job.pipeline_status,
    ]
      .map(escapeCsv)
      .join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}
