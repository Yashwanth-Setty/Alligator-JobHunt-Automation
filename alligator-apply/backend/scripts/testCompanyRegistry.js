/**
 * Smoke test for Company Registry (Phase 1A + 1B).
 * Run: npm run test:registry
 */

import { getDb } from '../src/db/database.js';
import { seedSourcesIfEmpty } from '../src/services/sourceStore.js';
import {
  buildCareersUrl,
  importFromSourceTargets,
  countSourceTargetsForImport,
  getRegistryEntryBySourceToken,
} from '../src/services/companyRegistry/registryImport.js';
import {
  TEST_REGISTRY_PREFIX,
  cleanupTestRegistryData,
  findOrCreateCompany,
  getCompanyById,
  getRegistryEntryById,
  listCompanyTags,
  listRegistryEntries,
  countRegistryEntries,
  upsertRegistryEntry,
} from '../src/services/companyRegistry/registryStore.js';
import { getTargetsForSource } from '../src/sources/sourceConfig.js';

const TEST_COMPANY_NAME = '__test__ Registry Smoke Co';
const TEST_BOARD_TOKEN = `${TEST_REGISTRY_PREFIX}registry-smoke-co`;

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function tableExists(name) {
  const row = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function assertNoTestTargetsInScans() {
  const gh = getTargetsForSource('greenhouse');
  assert(!gh.includes(TEST_BOARD_TOKEN), 'test board token excluded from scans');
  assert(!gh.includes('registry-smoke-co'), 'legacy smoke token excluded from scans');
}

function main() {
  console.log('\n── Company Registry Phase 1A smoke test ──');
  getDb();
  cleanupTestRegistryData();

  try {
    for (const table of [
      'companies',
      'company_tags',
      'company_tag_links',
      'company_registry_entries',
    ]) {
      assert(tableExists(table), `table ${table} exists`);
    }
    console.log('  ✓ all registry tables present');

    const tags = listCompanyTags();
    assert(tags.length >= 8, 'seed tags present');
    assert(tags.some((t) => t.slug === 'ai'), 'ai tag seeded');
    assert(tags.some((t) => t.slug === 'fintech'), 'fintech tag seeded');
    console.log(`  ✓ ${tags.length} tags in catalog`);

    const beforeCount = countRegistryEntries();

    const { company, created: companyCreated } = findOrCreateCompany({
      name: TEST_COMPANY_NAME,
      domain: 'test.invalid',
      industry: 'Testing',
    });

    assert(company.id, 'company id assigned');
    assert(company.name === TEST_COMPANY_NAME, 'test company name preserved');
    assert(company.normalizedName.startsWith(TEST_REGISTRY_PREFIX), 'test normalized name prefix');
    console.log(
      `  ✓ company ${companyCreated ? 'created' : 'reused'}:`,
      company.name,
      `(${company.id.slice(0, 8)}…)`
    );

    const { entry, action: entryAction } = upsertRegistryEntry({
      companyId: company.id,
      source: 'greenhouse',
      careersUrl: `https://boards.greenhouse.io/${TEST_BOARD_TOKEN}`,
      boardToken: TEST_BOARD_TOKEN,
      connectionPayload: { contentOnFetch: false, __test: true },
      priority: 80,
      enabled: true,
    });

    assert(entry.id, 'registry entry id assigned');
    assert(entry.source === 'greenhouse', 'source is greenhouse');
    assert(entry.boardToken === TEST_BOARD_TOKEN, 'test board token stored');
    assert(entry.connectionPayload.contentOnFetch === false, 'connection payload parsed');
    assert(entry.lastScanStatus === 'never', 'initial scan status is never');
    assert(entry.company?.name === TEST_COMPANY_NAME, 'entry includes company');
    console.log(`  ✓ registry entry ${entryAction}:`, entry.source, entry.boardToken);

    const reloaded = getRegistryEntryById(entry.id);
    assert(reloaded.companyId === company.id, 'reload entry by id');
    assert(getCompanyById(company.id), 'reload company');
    if (companyCreated || entryAction === 'created') {
      assert(countRegistryEntries() >= beforeCount, 'entry count did not shrink');
    }

    assertNoTestTargetsInScans();
    console.log('  ✓ test entry excluded from getTargetsForSource while enabled');

    console.log('\n── Company Registry Phase 1B import test ──');
    seedSourcesIfEmpty();
    const targetCount = countSourceTargetsForImport();
    assert(targetCount >= 4, 'source_targets has supported rows to import');
    console.log(`  ✓ ${targetCount} importable source_targets rows`);

    assert(
      buildCareersUrl('greenhouse', 'stripe') === 'https://boards.greenhouse.io/stripe',
      'greenhouse careers URL template'
    );
    assert(
      buildCareersUrl('lever', 'spotify') === 'https://jobs.lever.co/spotify',
      'lever careers URL template'
    );

    const countBeforeImport = countRegistryEntries();
    const first = importFromSourceTargets();
    assert(first.imported + first.updated >= targetCount, 'first import processes all targets');
    assert(first.errors.length === 0, 'first import has no errors');
    assert(countRegistryEntries() >= countBeforeImport, 'registry grew or held after import');
    console.log(
      `  ✓ first import: created ${first.imported}, updated ${first.updated}, companies +${first.companiesCreated}`
    );

    const stripeEntryId = getRegistryEntryBySourceToken('greenhouse', 'stripe');
    assert(stripeEntryId, 'stripe greenhouse entry exists after import');
    const stripeEntry = getRegistryEntryById(stripeEntryId);
    assert(
      stripeEntry.careersUrl === 'https://boards.greenhouse.io/stripe',
      'import set greenhouse careers URL for stripe'
    );

    const countAfterFirst = countRegistryEntries();
    const second = importFromSourceTargets();
    assert(second.imported === 0, 'second import creates no new entries');
    assert(second.updated >= targetCount, 'second import updates existing entries');
    assert(second.companiesCreated === 0, 'second import creates no new companies');
    assert(second.errors.length === 0, 'second import has no errors');
    assert(countRegistryEntries() === countAfterFirst, 'entry count stable on re-import');
    console.log(`  ✓ second import idempotent: updated ${second.updated}, created 0`);

    const ghEntries = listRegistryEntries({ source: 'greenhouse' });
    assert(ghEntries.some((e) => e.boardToken === 'airbnb'), 'airbnb greenhouse entry imported');

    console.log('\n── summary: Company Registry Phase 1A + 1B passed ──\n');
  } finally {
    cleanupTestRegistryData();
    assertNoTestTargetsInScans();
    console.log('  ✓ test registry data cleaned up');
  }
}

main();
