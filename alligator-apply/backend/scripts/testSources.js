#!/usr/bin/env node
/**
 * Smoke test for job source adapters.
 *
 * Usage:
 *   npm run test:sources              # mock mode (default)
 *   npm run test:sources -- --live    # real APIs (MOCK_MODE=false)
 *   node scripts/testSources.js greenhouse lever --live
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createActiveAdapters,
  parseJobSources,
  getTargetsForSource,
  isMockMode,
} from '../src/sources/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const args = process.argv.slice(2);
const liveFlag = args.includes('--live');
const sourceArgs = args.filter((a) => !a.startsWith('--'));

if (liveFlag) {
  process.env.MOCK_MODE = 'false';
}

const filters = {
  keywords: process.env.TEST_KEYWORDS || '',
  location: process.env.TEST_LOCATION || '',
  remoteType: process.env.TEST_REMOTE_TYPE || '',
};

async function testAdapter(adapter) {
  const label = adapter.name;
  const targets = getTargetsForSource(label);
  console.log(`\n── ${label} ──`);
  console.log(`  mode: ${isMockMode() ? 'mock' : 'live'}`);
  console.log(`  targets: ${targets.length ? targets.join(', ') : '(none configured)'}`);

  const started = Date.now();
  try {
    const result = await adapter.search(filters, { page: 1, limit: 10 });
    const jobs = result.jobs || [];
    console.log(`  status: ok (${Date.now() - started}ms)`);
    console.log(`  fetched: ${result.stats?.fetched ?? jobs.length}`);
    console.log(`  after filters: ${result.stats?.afterFilters ?? jobs.length}`);
    console.log(`  returned page: ${jobs.length} (total ${result.total}, hasMore ${result.hasMore})`);

    if (jobs[0]) {
      const j = jobs[0];
      console.log(`  sample: ${j.title} @ ${j.company}`);
      console.log(`          ${j.location} | ${j.workMode} | ${j.applyUrl?.slice(0, 60)}…`);
      const missing = ['id', 'source', 'atsType', 'company', 'title', 'applyUrl', 'rawData'].filter(
        (k) => j[k] === undefined || j[k] === ''
      );
      if (missing.length) console.warn(`  warn: missing fields on sample: ${missing.join(', ')}`);
    } else {
      console.log('  sample: (no jobs)');
    }
    return { name: label, ok: true, count: jobs.length };
  } catch (err) {
    console.log(`  status: FAILED (${Date.now() - started}ms)`);
    console.log(`  error: ${err.message}`);
    return { name: label, ok: false, error: err.message };
  }
}

async function main() {
  console.log('Alligator Apply — source adapter smoke test');
  console.log(`MOCK_MODE=${isMockMode() ? 'true (mock)' : 'false (live)'}`);
  console.log(`JOB_SOURCES=${parseJobSources().join(',')}`);

  let adapters = createActiveAdapters();
  if (sourceArgs.length > 0) {
    const wanted = new Set(sourceArgs.map((s) => s.toLowerCase()));
    adapters = adapters.filter((a) => wanted.has(a.name));
    if (adapters.length === 0) {
      console.error('No matching adapters for:', sourceArgs.join(', '));
      process.exit(1);
    }
  }

  const results = [];
  for (const adapter of adapters) {
    results.push(await testAdapter(adapter));
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n── summary ──');
  console.log(`  passed: ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    failed.forEach((f) => console.log(`  ✗ ${f.name}: ${f.error}`));
    process.exit(1);
  }
  console.log('  all sources ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
