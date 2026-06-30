/**
 * Workday provider adapter tests (Phase 2B).
 * Run: npm run test:workday
 * Optional live: node scripts/testWorkdayAdapter.js --live
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../src/db/database.js';
import { WorkdayAdapter } from '../src/sources/workday.adapter.js';
import { runProviderSearch } from '../src/sources/providers/providerRunner.js';
import { cleanupTestRegistryData } from '../src/services/companyRegistry/registryStore.js';
import { findOrCreateCompany, upsertRegistryEntry } from '../src/services/companyRegistry/registryStore.js';
import { buildWorkdayBoardToken, buildWorkdayCareersUrlFromPayload } from '../src/sources/workdayCxs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const liveFlag = process.argv.includes('--live');
if (liveFlag) {
  process.env.MOCK_MODE = 'false';
} else {
  process.env.MOCK_MODE = 'true';
}

const NVIDIA_PAYLOAD = {
  tenant: 'nvidia',
  wdInstance: 'wd5',
  hostSlug: 'nvidia',
  site: 'NVIDIAExternalCareerSite',
  locale: 'en-US',
  pageSize: 20,
  fetchDetails: false,
};

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function seedNvidiaTarget() {
  const { company } = findOrCreateCompany({ name: 'NVIDIA', industry: 'Semiconductors' });
  upsertRegistryEntry({
    companyId: company.id,
    source: 'workday',
    boardToken: buildWorkdayBoardToken('nvidia', 'NVIDIAExternalCareerSite'),
    careersUrl: buildWorkdayCareersUrlFromPayload(NVIDIA_PAYLOAD),
    connectionPayload: NVIDIA_PAYLOAD,
    priority: 80,
    enabled: true,
  });
}

async function main() {
  console.log('\n── Workday adapter tests ──');
  getDb();
  cleanupTestRegistryData();
  seedNvidiaTarget();

  const adapter = new WorkdayAdapter();
  assert(adapter.metadata().implemented === true, 'workday implemented');
  assert(adapter.metadata().targetKind === 'connection_payload', 'target kind');

  const discovered = adapter.discover();
  assert(discovered.some((t) => t.boardToken.includes('nvidia')), 'discover finds NVIDIA target');
  console.log(`  ✓ discover (${discovered.length} targets)`);

  const validation = adapter.validateTarget(discovered[0]);
  assert(validation.valid, 'validateTarget on discovered row');

  if (!liveFlag) {
    const result = await adapter.fetchJobs({}, { page: 1, limit: 5 });
    assert(Array.isArray(result.jobs), 'mock fetchJobs returns jobs');
    assert(result.jobs.length >= 1, 'mock workday jobs present');
    assert(result.jobs.every((j) => j.source === 'workday'), 'mock jobs source workday');

    const runner = await runProviderSearch(adapter, {}, {});
    assert(runner.jobs.length >= 1, 'runProviderSearch mock');
    console.log(`  ✓ mock adapter (${result.jobs.length} jobs)`);
  } else {
    console.log('  ○ live mode — fetching NVIDIA CXS (may take a few seconds)');
    const health = await adapter.healthCheck(discovered[0]);
    assert(health.ok, `NVIDIA healthCheck: ${health.error || 'ok'}`);
    console.log(`  ✓ live healthCheck (${health.sampleCount ?? 0} sample postings)`);

    const result = await adapter.fetchJobs({ keywords: 'engineer' }, { page: 1, limit: 10 });
    assert(Array.isArray(result.jobs), 'live fetchJobs returns jobs');
    console.log(`  ✓ live fetchJobs (${result.jobs.length} jobs after filters)`);
    if (result.jobs[0]) {
      console.log(`    sample: ${result.jobs[0].title} @ ${result.jobs[0].company}`);
    }
  }

  cleanupTestRegistryData();
  console.log('\n── summary: Workday adapter tests passed ──\n');
}

main().catch((err) => {
  console.error('\nWorkday adapter test failed:', err.message);
  cleanupTestRegistryData();
  process.exit(1);
});
