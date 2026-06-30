/**
 * Phase 3 — seed 500+ engineering employers into the Company Registry.
 * Run: npm run registry:seed:expansion
 *
 * Idempotent: safe to re-run; updates existing entries.
 */

import { getDb } from '../src/db/database.js';
import {
  seedAllRegistryDatasets,
  validateAllSeedDatasets,
  loadAllSeedDatasets,
} from '../src/services/companyRegistry/registrySeedLoader.js';
import { getRegistryStatsSummary } from '../src/services/companyRegistry/registryStore.js';

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const validateOnly = process.argv.includes('--validate');

  getDb();

  console.log('\n── Registry expansion seed ──');

  const datasets = loadAllSeedDatasets();
  const validation = validateAllSeedDatasets(datasets);

  console.log('Seed datasets:');
  for (const [source, info] of Object.entries(validation.bySource)) {
    console.log(`  ${source}: ${info.count} rows${info.valid ? '' : ' (INVALID)'}`);
  }
  console.log(`  TOTAL: ${validation.total} rows`);

  if (!validation.valid) {
    console.error('\nValidation errors:');
    validation.errors.slice(0, 30).forEach((e) => console.error(`  ✗ ${e}`));
    if (validation.errors.length > 30) {
      console.error(`  … and ${validation.errors.length - 30} more`);
    }
    process.exit(1);
  }

  if (validateOnly) {
    console.log('\n✓ All seed datasets valid (--validate only, no DB writes)\n');
    return;
  }

  if (dryRun) {
    console.log('\nDry run — no DB writes.\n');
    return;
  }

  const before = getRegistryStatsSummary();
  const result = seedAllRegistryDatasets();

  if (result.errors.length) {
    console.error('\nSeed errors:');
    result.errors.slice(0, 20).forEach((e) => console.error(`  ✗ [${e.source}] ${e.name}: ${e.error}`));
  }

  const after = getRegistryStatsSummary();

  console.log('\n── Seed complete ──');
  console.log(`  companies created: ${result.companiesCreated}`);
  console.log(`  entries created:   ${result.entriesCreated}`);
  console.log(`  entries updated:   ${result.entriesUpdated}`);
  console.log(`  skipped:           ${result.skipped}`);
  console.log(`  registry total:    ${before.totalEntries} → ${after.totalEntries} entries`);
  console.log(`  enabled entries:   ${after.enabledEntries}`);
  console.log('\n  By source (enabled/total):');
  for (const row of after.entriesBySource) {
    console.log(`    ${row.source}: ${row.enabled}/${row.total}`);
  }
  console.log('');
}

main();
