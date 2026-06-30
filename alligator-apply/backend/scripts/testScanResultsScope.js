/**
 * Scan results must stay scoped to the same scanRunId after completion.
 * Run: npm run test:scan-results-scope
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.join(os.tmpdir(), `alligator-scan-scope-${process.pid}.db`);
if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
process.env.DATABASE_PATH = testDb;

const { v4: uuidv4 } = await import('uuid');
const { getDb, now } = await import('../src/db/database.js');
const { listJobs } = await import('../src/services/jobScanService.js');
const { scanFiltersSignature } = await import('../src/services/scanMetrics.js');

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

function seedScan({ status, jobCount, filters = {} }) {
  const db = getDb();
  const scanId = uuidv4();
  const ts = now();
  const sig = scanFiltersSignature(filters);
  db.prepare(
    `INSERT INTO scan_runs (id, status, progress, message, jobs_found, started_at, finished_at, search_filters)
     VALUES (?, ?, 100, 'scope test', ?, ?, ?, ?)`
  ).run(
    scanId,
    status,
    jobCount,
    ts,
    status === 'completed' ? ts : null,
    sig
  );

  for (let i = 0; i < jobCount; i += 1) {
    insertJob(db, {
      id: `${scanId}-job-${i}`,
      company: 'Stripe',
      title: `Engineer ${i}`,
      url: `https://example.com/${i}`,
      source: 'greenhouse',
      score: 70,
      location: 'Remote, United States',
      remote_type: 'remote',
      employment_type: 'full_time',
      experience_level: 'mid',
      visa_fit: 'positive',
      auto_apply_eligible: 1,
      pipeline_status: 'matched',
      data_source: 'live',
      description: 'Java developer',
      scan_run_id: scanId,
      created_at: ts,
      updated_at: ts,
    });
  }
  return { scanId, sig, filters };
}

console.log('\n── scan results scope (running → completed) ──');
getDb();

const filters = { keywords: 'Java Developer', location: 'United States', minScore: '50' };
const { scanId } = seedScan({ status: 'running', jobCount: 75, filters });

const duringRunning = listJobs({
  page: 1,
  limit: 25,
  filters: { ...filters, scanRunId: scanId },
  tab: 'all',
});
assert(duringRunning.pagination.total === 75, `during scan with scanRunId returns 75 (${duringRunning.pagination.total})`);

const db = getDb();
db.prepare(`UPDATE scan_runs SET status = 'completed', finished_at = ? WHERE id = ?`).run(now(), scanId);

const afterCompleteExplicit = listJobs({
  page: 1,
  limit: 25,
  filters: { ...filters, scanRunId: scanId },
  tab: 'all',
});
assert(
  afterCompleteExplicit.pagination.total === 75,
  `after completion with same scanRunId returns 75 (${afterCompleteExplicit.pagination.total})`
);

const afterCompleteResolved = listJobs({
  page: 1,
  limit: 25,
  filters,
  tab: 'all',
});
assert(
  afterCompleteResolved.pagination.total === 75,
  `after completion with matching filters resolves scan and returns 75 (${afterCompleteResolved.pagination.total})`
);

const withoutScope = listJobs({
  page: 1,
  limit: 25,
  filters: { minScore: '50' },
  tab: 'all',
});
assert(withoutScope.pagination.total === 0, 'without scanRunId or matching filters returns 0');

console.log(`\n── summary: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
