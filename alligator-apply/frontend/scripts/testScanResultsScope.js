/**
 * Frontend unit tests for scan result scope keys.
 * Run: npm run test:scan-scope
 *
 * Manual verification (Job Hunt page):
 * 1. Start scan with keywords + location — note console: [JobHunt] scan started id=<uuid>
 * 2. While running, All Jobs tab shows partial rows (e.g. 75) — console: getJobs scanRunId=<same uuid>
 * 3. When scan completes — console: [JobHunt] scan completed id=<same uuid>
 * 4. All Jobs tab still shows 75 — getJobs/getKpi/getFunnel all log the same scanRunId
 * 5. Change minScore only — table stays at 75 (scope not cleared)
 * 6. Change keywords — console: scope filters changed — table clears until new scan
 */
import {
  resultsScopeFiltersKey,
  shouldKeepResultsScope,
} from '../src/lib/scanResultsScope.js';

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

console.log('\n── scanResultsScope ──');

const base = { keywords: 'Java', location: 'United States', remoteType: 'remote', minScore: '50' };
const key1 = resultsScopeFiltersKey(base);
const key2 = resultsScopeFiltersKey({ ...base, minScore: '70' });
const key3 = resultsScopeFiltersKey({ keywords: 'Python', location: 'United States', remoteType: 'remote' });

assert(key1 === key2, 'minScore change does not change scope key');
assert(key1 !== key3, 'keywords change changes scope key');
assert(
  shouldKeepResultsScope(key1, key2, 'scan-abc'),
  'keep scope when only minScore differs'
);
assert(
  !shouldKeepResultsScope(key1, key3, 'scan-abc'),
  'drop scope when keywords change'
);
assert(shouldKeepResultsScope(null, key1, 'scan-abc'), 'keep scope when session key not set yet');

console.log(`\n── summary: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
