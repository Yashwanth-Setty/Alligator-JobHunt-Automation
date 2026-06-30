#!/usr/bin/env node
/**
 * Trace greenhouse/stripe through the real scan pipeline — no UI, no full scan.
 *
 * Usage:
 *   npm run debug:scan-pipeline
 *   npm run debug:scan-pipeline -- --persist
 *   npm run debug:scan-pipeline -- --keywords "Java Backend Developer" --source greenhouse
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const projectRoot = path.join(__dirname, '../..');
if (process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.isAbsolute(process.env.DATABASE_PATH)
    ? process.env.DATABASE_PATH
    : path.resolve(projectRoot, process.env.DATABASE_PATH.replace(/^\.\//, ''));
} else {
  process.env.DATABASE_PATH = path.join(__dirname, '../data/alligator.db');
}

// ── CLI args ──────────────────────────────────────────────────────────────────
function getCliArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const cliKeywords = getCliArg('keywords');  // e.g. "Java Backend Developer"
const cliSource   = getCliArg('source') || 'greenhouse';
const persistFlag = process.argv.includes('--persist');

process.env.MOCK_MODE = 'false';
process.env.JOB_SOURCES = cliSource;
// Only override GREENHOUSE_BOARDS with 'stripe' when no --keywords supplied;
// with --keywords we let the registry planner choose targets so promotion fires.
if (!cliKeywords) {
  process.env.GREENHOUSE_BOARDS = 'stripe';
} else {
  delete process.env.GREENHOUSE_BOARDS;
}

const {
  getTargetsForSource,
} = await import('../src/sources/sourceConfig.js');
const { createActiveProviders } = await import('../src/sources/providers/providerRegistry.js');
const { runProviderSearch } = await import('../src/sources/providers/providerRunner.js');
const { runSourceScan } = await import('../src/sources/scanOrchestrator.js');
const { lightEnrichJob, enrichJobQuality } = await import('../src/sources/qualityScore.js');
const { dedupeJobsWithStats } = await import('../src/sources/dedupe.js');
const { getMaxTotalResults, isFastScan } = await import('../src/sources/scanConfig.js');
const { clearSourceCache } = await import('../src/sources/sourceCache.js');
const {
  ScanDiagnosticsCollector,
  runWithScanDiagnostics,
} = await import('../src/services/scanDiagnostics.js');
const { getResumeScoringContext } = await import('../src/services/resumeScoringContext.js');
const { getDb, now } = await import('../src/db/database.js');
const { jobToDbRow } = await import('../src/sources/types.js');

const SCENARIOS = cliKeywords
  ? [{ name: 'keyword-intent', filters: { keywords: cliKeywords } }]
  : [
      { name: 'no-filter', filters: {} },
      {
        name: 'keyword-location',
        filters: {
          keywords: 'Full Stack Java Developer',
          location: 'United States',
        },
      },
    ];

function printBlock(title, rows) {
  console.log(`\n--- ${title} ---`);
  for (const [key, value] of rows) {
    if (value === undefined) continue;
    if (typeof value === 'object' && value !== null) {
      console.log(`${key}: ${JSON.stringify(value, null, 2)}`);
    } else {
      console.log(`${key}: ${value}`);
    }
  }
}

async function stopActiveUiScan() {
  try {
    const res = await fetch('http://localhost:4000/api/jobs/scan/stop', { method: 'POST' });
    if (res.ok) {
      const body = await res.json();
      if (body?.stopped) console.log('[debug:scan-pipeline] stopped active UI scan');
    }
  } catch {
    // backend optional
  }
}

function persistDebugJobs(jobs, scanRunId) {
  const db = getDb();
  const ts = now();
  let inserted = 0;
  let updated = 0;
  const existsStmt = db.prepare('SELECT id FROM jobs WHERE id = ?');
  const insertJob = db.prepare(
    `INSERT INTO jobs (id, company, title, url, source, score, location, normalized_location, remote_type,
      employment_type, experience_level, visa_fit, auto_apply_eligible, pipeline_status,
      data_source, description, quality_checks, scan_run_id, salary_min, salary_max, date_posted, created_at, updated_at)
     VALUES (@id, @company, @title, @url, @source, @score, @location, @normalized_location, @remote_type,
      @employment_type, @experience_level, @visa_fit, @auto_apply_eligible, @pipeline_status,
      @data_source, @description, @quality_checks, @scan_run_id, @salary_min, @salary_max, @date_posted, @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
      score = excluded.score,
      scan_run_id = excluded.scan_run_id,
      updated_at = excluded.updated_at`
  );

  const tx = db.transaction((items) => {
    for (const job of items) {
      const row = jobToDbRow(job, ts);
      row.scan_run_id = scanRunId;
      row.quality_checks = JSON.stringify(job.qualityChecks || {});
      const exists = existsStmt.get(row.id);
      insertJob.run(row);
      if (exists) updated += 1;
      else inserted += 1;
    }
  });
  tx(jobs);
  return { inserted, updated, total: jobs.length };
}

function diagEarlyFilter(diagnostics) {
  const src = diagnostics?.sources?.greenhouse;
  if (!src?.targets?.length) return { rawFetched: 0, afterEarlyFilter: 0, targets: [] };
  return {
    rawFetched: src.targets.reduce((s, t) => s + (t.rawFetched || 0), 0),
    afterEarlyFilter: src.targets.reduce((s, t) => s + (t.afterEarlyFilter || 0), 0),
    targets: src.targets,
  };
}

function postProcessLikeOrchestrator(jobs, filters, matchThreshold) {
  const scoringCtx = getResumeScoringContext(filters.keywords || '', filters.location || '');
  const enrichOpts = {
    resumeKeywords: scoringCtx.skills,
    skillSource: scoringCtx.skillSource,
    preferredLocation: scoringCtx.preferredLocation,
    keywords: filters.keywords,
    location: filters.location,
  };

  const lightJobs = jobs.map((job) => lightEnrichJob(job, enrichOpts));
  const capped = lightJobs.slice(0, getMaxTotalResults());
  const { jobs: deduped, removed: duplicatesRemoved } = dedupeJobsWithStats(capped);
  const enriched = deduped.map((job) => enrichJobQuality(job, { ...enrichOpts, isDuplicate: false }));
  const afterMatch = enriched.filter((j) => (j.score || 0) >= matchThreshold);

  return {
    enrichOpts,
    lightJobs,
    capped,
    deduped,
    duplicatesRemoved,
    enriched,
    afterMatch,
    persistInputEstimate: lightJobs.length + deduped.length,
  };
}

async function traceScenario(scenario, { persist = false }) {
  clearSourceCache();

  const filters = { ...scenario.filters };
  const matchThreshold = filters.minScore != null ? Number(filters.minScore) : 0;
  const targets = getTargetsForSource(cliSource, { filters });
  const providers = createActiveProviders();
  const provider = providers.find((p) => p.name === 'greenhouse') || providers[0];

  if (!provider) {
    console.error('No greenhouse provider — check JOB_SOURCES');
    process.exit(1);
  }

  const scoringCtx = getResumeScoringContext(filters.keywords || '', filters.location || '');
  const enrichOpts = {
    resumeKeywords: scoringCtx.skills,
    skillSource: scoringCtx.skillSource,
    preferredLocation: scoringCtx.preferredLocation,
    keywords: filters.keywords,
    location: filters.location,
  };

  const diagnostics = new ScanDiagnosticsCollector(`debug-${scenario.name}`, {
    filters,
    activeSources: ['greenhouse'],
    targetsBySource: { greenhouse: targets },
    matchThreshold,
  });

  let persistInputCount = 0;
  const persistCalls = [];
  let dbPersist = { inserted: 0, updated: 0, total: 0 };
  const scanRunId = persist ? uuidv4() : null;

  if (persist && scanRunId) {
    getDb()
      .prepare(
        `INSERT INTO scan_runs (id, status, progress, message, search_filters, started_at)
         VALUES (?, 'running', 0, 'debug:scan-pipeline', ?, ?)`
      )
      .run(scanRunId, JSON.stringify(filters), now());
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`SCENARIO: ${scenario.name}`);
  console.log('='.repeat(60));

  printBlock('config', [
    ['source', 'greenhouse'],
    ['persist', persist],
    ['matchThreshold', matchThreshold],
    ['filters', filters],
    ['MOCK_MODE', process.env.MOCK_MODE],
    ['JOB_SOURCES', process.env.JOB_SOURCES],
    ['GREENHOUSE_BOARDS', process.env.GREENHOUSE_BOARDS],
  ]);

  printBlock('1. selectedTargets', [['targets', targets]]);

  let fetchResult;
  let searchResult;

  await runWithScanDiagnostics(diagnostics, async () => {
    fetchResult = await provider.fetchJobs(filters, {
      page: 1,
      limit: provider.maxResults,
      hooks: {
        onCompanyDone: (info) => {
          console.log(`[fetchJobs] ${info.target}: ${info.jobs} jobs (${info.fromCache ? 'cache' : 'live'})`);
        },
      },
    });
  });

  const earlyAfterFetch = diagEarlyFilter(diagnostics);

  printBlock('2. provider.fetchJobs', [
    ['jobsReturned', fetchResult.jobs?.length ?? 0],
    ['stats.fetched', fetchResult.stats?.fetched ?? null],
    ['stats.afterFilters', fetchResult.stats?.afterFilters ?? null],
    ['stats.rejectionCounts', fetchResult.stats?.rejectionCounts ?? {}],
    ['stats.rejectedSample', fetchResult.stats?.rejectedSample ?? []],
    ['sampleTitles', (fetchResult.jobs || []).slice(0, 5).map((j) => j.title)],
  ]);

  clearSourceCache();

  await runWithScanDiagnostics(diagnostics, async () => {
    searchResult = await runProviderSearch(provider, filters, {
      onCompanyDone: (info) => {
        console.log(`[runProviderSearch] ${info.target}: ${info.jobs} jobs (${info.fromCache ? 'cache' : 'live'})`);
      },
    });
  });

  const early = diagEarlyFilter(diagnostics);

  printBlock('3. runProviderSearch', [
    ['jobsReturned', searchResult.jobs?.length ?? 0],
    ['stats.fetched', searchResult.stats?.fetched ?? null],
    ['stats.afterFilters', searchResult.stats?.afterFilters ?? null],
    ['stats.rejectionCounts', searchResult.stats?.rejectionCounts ?? {}],
    ['error', searchResult.error ?? null],
    ['durationMs', searchResult.durationMs ?? null],
    ['sampleTitles', (searchResult.jobs || []).slice(0, 5).map((j) => j.title)],
  ]);

  printBlock('4. afterEarlyFilter (adapter passesEarlyFilter)', [
    ['rawFetched', early.rawFetched],
    ['afterEarlyFilter', early.afterEarlyFilter],
    ['droppedByEarlyFilter', Math.max(0, early.rawFetched - early.afterEarlyFilter)],
    ['fetchJobs.diagnostics.rawFetched', earlyAfterFetch.rawFetched],
    ['fetchJobs.diagnostics.afterEarlyFilter', earlyAfterFetch.afterEarlyFilter],
    ['perTarget', early.targets.map((t) => ({
      target: t.target,
      rawFetched: t.rawFetched,
      afterEarlyFilter: t.afterEarlyFilter,
      httpStatus: t.httpStatus,
      error: t.error,
    }))],
  ]);

  const post = postProcessLikeOrchestrator(searchResult.jobs || [], filters, matchThreshold);

  printBlock('5. afterQualityScore', [
    ['afterLightEnrich', post.lightJobs.length],
    ['afterCap', post.capped.length],
    ['afterFullEnrich', post.enriched.length],
    ['matchThreshold', matchThreshold],
    ['afterMatchThreshold', post.afterMatch.length],
    ['FAST_SCAN', isFastScan()],
    ['scoreSample', post.enriched.slice(0, 5).map((j) => ({
      title: j.title,
      score: j.score,
      qualityScore: j.qualityScore,
    }))],
  ]);

  printBlock('6. afterDedupe', [
    ['beforeDedupe', post.capped.length],
    ['afterDedupe', post.deduped.length],
    ['duplicatesRemoved', post.duplicatesRemoved],
  ]);

  clearSourceCache();

  let scanResult;
  await runWithScanDiagnostics(diagnostics, async () => {
    scanResult = await runSourceScan({
      filters,
      enrichOpts,
      matchThreshold,
      isAborted: () => false,
      diagnostics,
      onJobsReady: async (jobs, meta = {}) => {
        persistInputCount += jobs.length;
        persistCalls.push({
          source: meta.source || 'unknown',
          count: jobs.length,
          partial: Boolean(meta.partial),
          replace: Boolean(meta.replace),
        });
        if (persist && scanRunId && jobs.length) {
          const r = persistDebugJobs(jobs, scanRunId);
          dbPersist.inserted += r.inserted;
          dbPersist.updated += r.updated;
          dbPersist.total += r.total;
        }
      },
      onEnrichmentBatch: async (batch) => {
        persistInputCount += batch.length;
        persistCalls.push({ source: 'enrichmentBatch', count: batch.length });
        if (persist && scanRunId && batch.length) {
          const r = persistDebugJobs(batch, scanRunId);
          dbPersist.inserted += r.inserted;
          dbPersist.updated += r.updated;
          dbPersist.total += r.total;
        }
      },
    });
  });

  const statusRow = (scanResult?.sourceStatuses || []).find((s) => s.name === 'greenhouse') || {};

  printBlock('7. persistInput (runSourceScan onJobsReady)', [
    ['persistEnabled', persist],
    ['persistInputCount', persistInputCount],
    ['persistCalls', persistCalls],
    ['orchestratorPostProcessEstimate', post.persistInputEstimate],
  ]);

  printBlock('8. dbPersist', [
    ['scanRunId', scanRunId],
    ['inserted', dbPersist.inserted],
    ['updated', dbPersist.updated],
    ['rowsTouched', dbPersist.total],
    [
      'rowsForScanRun',
      scanRunId
        ? getDb().prepare('SELECT COUNT(*) AS c FROM jobs WHERE scan_run_id = ?').get(scanRunId)?.c
        : null,
    ],
  ]);

  printBlock('sourceStatuses accounting (full scan would show)', [
    ['jobsFetched', statusRow.jobsFetched ?? null],
    ['jobsAfterFilters', statusRow.jobsAfterFilters ?? null],
    ['jobsFound', statusRow.jobsFound ?? null],
    ['status', statusRow.status ?? null],
    ['error', statusRow.error ?? null],
    ['runSourceScan.finalJobs', scanResult?.jobs?.length ?? 0],
    ['runSourceScan.dedupedCount', scanResult?.dedupedCount ?? 0],
    ['runSourceScan.failedSources', scanResult?.failedSources ?? []],
  ]);

  if (persist && scanRunId) {
    getDb()
      .prepare(`UPDATE scan_runs SET status = 'completed', finished_at = ?, message = ? WHERE id = ?`)
      .run(now(), `debug:scan-pipeline ${scenario.name}`, scanRunId);
  }

  return {
    scenario: scenario.name,
    fetchJobsCount: fetchResult.jobs?.length ?? 0,
    fetchJobsAfterFilters: fetchResult.stats?.afterFilters ?? 0,
    runProviderSearchCount: searchResult.jobs?.length ?? 0,
    afterEarlyFilter: early.afterEarlyFilter,
    afterDedupe: post.deduped.length,
    runSourceScanJobs: scanResult?.jobs?.length ?? 0,
    sourceStatusFetched: statusRow.jobsFetched ?? 0,
    sourceStatusPersisted: statusRow.jobsPersisted ?? 0,
    error: searchResult.error || statusRow.error || null,
  };
}

async function main() {
  await stopActiveUiScan();
  getDb();

  console.log('debug:scan-pipeline — greenhouse/stripe only, real scan code path');
  console.log('No UI scan. No registry changes. No adapter URL changes.');

  const summaries = [];

  for (const scenario of SCENARIOS) {
    summaries.push(await traceScenario(scenario, { persist: false }));
  }

  if (persistFlag) {
    summaries.push(await traceScenario(SCENARIOS[0], { persist: true }));
  }

  printBlock('SUMMARY', [['scenarios', summaries]]);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
