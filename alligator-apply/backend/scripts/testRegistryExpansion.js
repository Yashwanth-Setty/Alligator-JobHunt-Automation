/**
 * Phase 3 — validation tests for registry expansion seed datasets.
 * Run: npm run test:registry-expansion
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const testDb = path.join(os.tmpdir(), `alligator-registry-expansion-${process.pid}.db`);
if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
process.env.DATABASE_PATH = testDb;

const { getDb } = await import('../src/db/database.js');
const {
  loadAllSeedDatasets,
  validateAllSeedDatasets,
  seedAllRegistryDatasets,
  REGISTRY_DATA_DIR,
  SEED_SOURCES,
} = await import('../src/services/companyRegistry/registrySeedLoader.js');
const { buildCareersUrl } = await import('../src/services/companyRegistry/registryImport.js');
const {
  cleanupTestRegistryData,
  countRegistryEntries,
  getRegistryEntryById,
  listRegistryEntries,
} = await import('../src/services/companyRegistry/registryStore.js');
const {
  buildWorkdayBoardToken,
  buildWorkdayCareersUrlFromPayload,
} = await import('../src/sources/workdayCxs.js');

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

function findEntry(entries, source, boardToken) {
  return entries.find((e) => e.source === source && e.boardToken === boardToken);
}

console.log('\n── Registry expansion validation ──');

for (const source of SEED_SOURCES) {
  const filePath = path.join(REGISTRY_DATA_DIR, `${source}.json`);
  assert(fs.existsSync(filePath), `${source}.json exists`);
}

const datasets = loadAllSeedDatasets();
const validation = validateAllSeedDatasets(datasets);
assert(validation.valid, 'all seed datasets pass validation');
assert(validation.total >= 500, `seed total >= 500 (${validation.total})`);

for (const source of SEED_SOURCES) {
  const count = validation.bySource[source]?.count ?? 0;
  assert(count > 0, `${source} has seed rows (${count})`);
}

const ghStripe = datasets.greenhouse.find((r) => r.boardToken === 'stripe');
assert(ghStripe?.name === 'Stripe', 'greenhouse includes Stripe');
assert(ghStripe?.industry === 'FinTech', 'Stripe has industry metadata');
assert(Array.isArray(ghStripe?.tags), 'Stripe has tags array');
assert(
  buildCareersUrl('greenhouse', 'stripe') === 'https://boards.greenhouse.io/stripe',
  'Stripe careers URL template'
);

const wdNvidia = datasets.workday.find((r) => r.name === 'NVIDIA');
assert(wdNvidia?.connectionPayload?.tenant === 'nvidia', 'workday includes NVIDIA');
const nvidiaToken = buildWorkdayBoardToken('nvidia', 'NVIDIAExternalCareerSite');
assert(nvidiaToken === 'nvidia::NVIDIAExternalCareerSite', 'NVIDIA board token format');
assert(
  buildWorkdayCareersUrlFromPayload(wdNvidia.connectionPayload).includes('myworkdayjobs.com'),
  'NVIDIA careers URL built from payload'
);

const manifestPath = path.join(REGISTRY_DATA_DIR, 'manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json exists');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert(manifest.total >= 500, `manifest total >= 500 (${manifest.total})`);

console.log('\n── Registry expansion idempotent seed ──');
getDb();
cleanupTestRegistryData();

const first = seedAllRegistryDatasets();
assert(first.errors.length === 0, 'first seed has no errors');
assert(first.entriesCreated >= 500, `first seed creates 500+ entries (${first.entriesCreated})`);

const countAfterFirst = countRegistryEntries();
const second = seedAllRegistryDatasets();
assert(second.entriesCreated === 0, 'second seed creates no new entries');
assert(second.entriesUpdated >= 500, `second seed updates existing entries (${second.entriesUpdated})`);
assert(countRegistryEntries() === countAfterFirst, 'entry count stable on re-seed');

const allEntries = listRegistryEntries({ limit: 10000 });
const stripe = findEntry(allEntries, 'greenhouse', 'stripe');
const stripeEntry = getRegistryEntryById(stripe.id);
assert(stripeEntry?.careersUrl?.includes('greenhouse.io/stripe'), 'DB stripe entry has careers URL');
assert(stripeEntry?.company?.industry === 'FinTech', 'DB stripe company industry persisted');
assert(
  stripeEntry?.company?.remotePolicy === 'remote_first',
  'DB stripe company remotePolicy persisted'
);

assert(findEntry(allEntries, 'greenhouse', 'openai'), 'OpenAI greenhouse entry seeded');
assert(findEntry(allEntries, 'greenhouse', 'anthropic'), 'Anthropic greenhouse entry seeded');
assert(
  allEntries.some((e) => e.source === 'workday' && e.boardToken?.startsWith('microsoft::')),
  'Microsoft workday entry seeded'
);

const remoteSample = getDb()
  .prepare("SELECT remote_policy FROM companies WHERE remote_policy != 'unknown' LIMIT 1")
  .get();
assert(remoteSample, 'at least one company has remotePolicy metadata');

console.log(`\n── summary: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
