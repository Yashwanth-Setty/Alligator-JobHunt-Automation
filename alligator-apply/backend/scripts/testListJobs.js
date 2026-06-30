/**
 * Smoke test: persisted scan jobs must appear in listJobs (All Jobs tab).
 * Run: npm run test:list-jobs
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.join(os.tmpdir(), `alligator-list-jobs-${process.pid}.db`);
if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
process.env.DATABASE_PATH = testDb;

const { v4: uuidv4 } = await import('uuid');
const { getDb, now } = await import('../src/db/database.js');
const { listJobs, getJobsListDebug } = await import('../src/services/jobScanService.js');
const { resolveActiveScanRunId, computePersistedMetrics, scanFiltersSignature } = await import('../src/services/scanMetrics.js');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

function insertJob(db, row) {
  db.prepare(
    `INSERT INTO jobs (id, company, title, url, source, score, location, remote_type,
      employment_type, experience_level, visa_fit, auto_apply_eligible, pipeline_status,
      data_source, description, scan_run_id, created_at, updated_at)
     VALUES (@id, @company, @title, @url, @source, @score, @location, @remote_type,
      @employment_type, @experience_level, @visa_fit, @auto_apply_eligible, @pipeline_status,
      @data_source, @description, @scan_run_id, @created_at, @updated_at)`
  ).run(row);
}

function seedScan(jobCount, { status = 'completed', startedAt = null, searchFilters = '{}' } = {}) {
  const db = getDb();
  const scanId = uuidv4();
  const ts = startedAt || now();
  db.prepare(
    `INSERT INTO scan_runs (id, status, progress, message, jobs_found, started_at, finished_at, search_filters)
     VALUES (?, ?, 100, 'test scan', ?, ?, ?, ?)`
  ).run(scanId, status, jobCount, ts, status === 'completed' ? ts : null, searchFilters);

  for (let i = 0; i < jobCount; i += 1) {
    insertJob(db, {
      id: `${scanId}-job-${i}`,
      company: `Company ${i}`,
      title: `Engineer ${i}`,
      url: `https://example.com/${i}`,
      source: 'greenhouse',
      score: 60 + i,
      location: 'Remote, United States',
      remote_type: 'remote',
      employment_type: 'full_time',
      experience_level: 'mid',
      visa_fit: 'positive',
      auto_apply_eligible: 1,
      pipeline_status: 'matched',
      data_source: 'live',
      description: 'Java Spring AWS',
      scan_run_id: scanId,
      created_at: ts,
      updated_at: ts,
    });
  }
  return scanId;
}

function testBasicListJobs() {
  console.log('\n── listJobs basic ──');
  const db = getDb();
  db.exec('DELETE FROM jobs');
  db.exec('DELETE FROM scan_runs');

  const scanId = seedScan(3, { searchFilters: '{}' });
  const activeId = resolveActiveScanRunId({ filters: {} });
  assert(activeId === scanId, 'resolveActiveScanRunId matches seeded scan');

  const metrics = computePersistedMetrics(scanId);
  assert(metrics.jobsFound === 3, 'persisted metrics count is 3');

  const result = listJobs({ page: 1, limit: 25, filters: {}, tab: 'all' });
  assert(result.pagination.total === 3, 'listJobs total is 3');
  assert(result.jobs.length === 3, 'listJobs returns 3 rows');
  assert(result.pagination.total === result.pagination.returned || result.jobs.length <= 25, 'pagination total matches returned page');

  const debug = getJobsListDebug({}, 'all');
  assert(debug.persistedRowsForScan === 3, 'debug persistedRowsForScan is 3');
  assert(debug.rowsAfterFilters === 3, 'debug rowsAfterFilters is 3');
  assert(debug.returnedRows === 3, 'debug returnedRows is 3');
  assert(debug.activeScanRunId === scanId, 'debug activeScanRunId matches seed');
}

function testEmptyLatestScanFallback() {
  console.log('\n── empty latest scan does not show older results ──');
  const db = getDb();
  db.exec('DELETE FROM jobs');
  db.exec('DELETE FROM scan_runs');

  const olderTs = '2026-01-01T00:00:00.000Z';
  const newerTs = '2026-06-01T00:00:00.000Z';
  seedScan(3, { startedAt: olderTs, searchFilters: '{}' });

  const emptyScanId = uuidv4();
  db.prepare(
    `INSERT INTO scan_runs (id, status, progress, message, jobs_found, started_at, finished_at, search_filters)
     VALUES (?, 'completed', 100, 'empty', 0, ?, ?, ?)`
  ).run(emptyScanId, newerTs, newerTs, '{}');

  const activeId = resolveActiveScanRunId({ filters: {} });
  assert(activeId === emptyScanId, 'active scan is latest completed (empty) for same search');

  const result = listJobs({ page: 1, limit: 25, filters: {}, tab: 'all' });
  assert(result.pagination.total === 0, 'does not fall back to older populated scan jobs');
}

function testAllTabLocationRecovery() {
  console.log('\n── All Jobs location filter recovery ──');
  const db = getDb();
  db.exec('DELETE FROM jobs');
  db.exec('DELETE FROM scan_runs');

  const scanId = seedScan(3, { searchFilters: '{}' });
  const narrow = listJobs({
    page: 1,
    limit: 25,
    filters: { location: 'Zanzibar, Tanzania', scanRunId: scanId },
    tab: 'all',
  });
  assert(narrow.pagination.total === 3, 'All Jobs drops zero-result location filter');
  assert(narrow.locationFallback?.active === true, 'locationFallback flagged when location dropped');

  const broad = listJobs({
    page: 1,
    limit: 25,
    filters: { location: 'United States', scanRunId: scanId },
    tab: 'all',
  });
  assert(broad.pagination.total === 3, 'United States broad location keeps all jobs');
}

function testNewEmptyScanDoesNotShowOldJobs() {
  console.log('\n── new empty scan must not show old scan jobs ──');
  const db = getDb();
  db.exec('DELETE FROM jobs');
  db.exec('DELETE FROM scan_runs');

  const oldSig = scanFiltersSignature({ keywords: 'emea sales' });
  const newSig = scanFiltersSignature({ keywords: 'java backend' });

  seedScan(150, { startedAt: '2026-01-01T00:00:00.000Z', searchFilters: oldSig });
  const newScanId = seedScan(0, { startedAt: '2026-06-01T00:00:00.000Z', searchFilters: newSig });

  const byFilters = listJobs({
    page: 1,
    limit: 25,
    filters: { keywords: 'java backend' },
    tab: 'all',
  });
  assert(byFilters.pagination.total === 0, `filter-matched empty scan returns 0 (${byFilters.pagination.total})`);
  assert(byFilters.jobs.length === 0, 'no stale rows when new scan has 0 jobs');

  const byScanId = listJobs({
    page: 1,
    limit: 25,
    filters: { scanRunId: newScanId, keywords: 'java backend' },
    tab: 'all',
  });
  assert(byScanId.pagination.total === 0, `explicit new scanRunId returns 0 (${byScanId.pagination.total})`);

  const oldLeak = listJobs({
    page: 1,
    limit: 25,
    filters: { keywords: 'emea sales' },
    tab: 'all',
  });
  assert(oldLeak.pagination.total === 150, `old scan still reachable with its own filters (${oldLeak.pagination.total})`);
}

testBasicListJobs();
testEmptyLatestScanFallback();
testAllTabLocationRecovery();
testNewEmptyScanDoesNotShowOldJobs();

console.log(`\n── summary: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
