/**
 * CLI: import source_targets → company registry
 * Run: npm run registry:import
 */

import { getDb } from '../src/db/database.js';
import {
  countSourceTargetsForImport,
  importFromSourceTargets,
} from '../src/services/companyRegistry/registryImport.js';
import { countRegistryEntries } from '../src/services/companyRegistry/registryStore.js';

getDb();

const before = countRegistryEntries();
const targetCount = countSourceTargetsForImport();
const result = importFromSourceTargets();

console.log('\n── Company Registry import (source_targets) ──');
console.log(`  Source targets (supported): ${targetCount}`);
console.log(`  Registry entries before:    ${before}`);
console.log(`  Companies created:          ${result.companiesCreated}`);
console.log(`  Entries created:            ${result.imported}`);
console.log(`  Entries updated:            ${result.updated}`);
console.log(`  Skipped:                    ${result.skipped}`);
console.log(`  Registry entries after:     ${countRegistryEntries()}`);

if (result.errors.length > 0) {
  console.log('\n  Errors:');
  for (const err of result.errors) {
    console.log(`    - ${err.source}/${err.slug}: ${err.error}`);
  }
}

console.log('\n✓ Import complete\n');

process.exit(result.errors.length > 0 ? 1 : 0);
