/**
 * Smoke test: scan A vs scan B — results must follow latest matching search.
 * Run: npm run test:scan-switch
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const testDb = path.join(os.tmpdir(), `alligator-scan-switch-${process.pid}.db`);
if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
process.env.DATABASE_PATH = testDb;

const { getDb, now } = await import('../src/db/database.js');
const { listJobs } = await import('../src/services/jobScanService.js');
const {
  resolveActiveScanRunId,
  scanFiltersSignature,
} = await import('../src/services/scanMetrics.js');

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

function insertScan(filters, jobTitles) {
  const db = getDb();
  const scanId = uuidv4();
  const ts = now();
  const sig = scanFiltersSignature(filters);

  db.prepare(
    `INSERT INTO scan_runs (id, status, progress, message, jobs_found, started_at, finished_at, search_filters)
     VALUES (?, 'completed', 100, 'test', ?, ?, ?, ?)`
  ).run(scanId, jobTitles.length, ts, ts, sig);

  const insertJob = db.prepare(
    `INSERT INTO jobs (id, company, title, url, source, score, location, pipeline_status,
      data_source, scan_run_id, created_at, updated_at)
     VALUES (?, 'TestCo', ?, 'https://example.com/j', 'greenhouse', 70, 'Remote', 'matched',
      'live', ?, ?, ?)`
  );

  for (let i = 0; i < jobTitles.length; i += 1) {
    insertJob.run(`${scanId}-job-${i}`, jobTitles[i], scanId, ts, ts);
  }

  return scanId;
}

console.log('\n── scan switch smoke test ──');
getDb();

const filtersA = { keywords: 'backend' };
const filtersB = { keywords: 'ai' };

const scanA = insertScan(filtersA, ['Backend Engineer', 'Backend Developer', 'Java Backend']);
// slight delay in timestamp order
const scanB = insertScan(filtersB, ['AI Engineer', 'ML Engineer', 'AI Researcher', 'AI Platform']);

const activeForB = resolveActiveScanRunId({ filters: filtersB });
assert(activeForB === scanB, 'active scan for "ai" is scan B');

const activeForA = resolveActiveScanRunId({ filters: filtersA });
assert(activeForA === scanA, 'active scan for "backend" is scan A');

const resultsB = listJobs({
  page: 1,
  limit: 25,
  filters: { scanRunId: scanB },
  tab: 'all',
});
assert(resultsB.pagination.total === 4, `scan B listJobs returns 4 rows (${resultsB.pagination.total})`);
assert(
  resultsB.jobs.every((j) => j.scan_run_id === scanB),
  'scan B jobs belong to scan B dataset'
);

const resultsA = listJobs({
  page: 1,
  limit: 25,
  filters: { scanRunId: scanA },
  tab: 'all',
});
assert(resultsA.pagination.total === 3, `scan A listJobs returns 3 rows (${resultsA.pagination.total})`);
assert(
  !resultsA.jobs.some((j) => j.title === 'AI Engineer'),
  'scan A results do not include scan B jobs'
);

const switched = listJobs({ page: 1, limit: 25, filters: filtersB, tab: 'all' });
assert(
  switched.pagination.total >= 3,
  `filter-matched scan B keyword query returns AI jobs (${switched.pagination.total})`
);
assert(
  !switched.jobs.some((j) => j.title === 'Backend Engineer'),
  'keyword-scoped results exclude scan A backend titles'
);

console.log(`\n── summary: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
