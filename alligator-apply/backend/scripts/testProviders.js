/**
 * Provider plugin framework smoke test (Phase 2A).
 * Run: npm run test:providers
 */

import { getDb } from '../src/db/database.js';
import {
  createActiveProviders,
  createAllProviders,
  getAllProviderMetadata,
  runProviderSearch,
  validateBoardTokenTarget,
} from '../src/sources/index.js';
import { importFromSourceTargets } from '../src/services/companyRegistry/registryImport.js';
import { seedSourcesIfEmpty } from '../src/services/sourceStore.js';

const LIVE_PROVIDERS = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'];

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function testContractMethods(provider) {
  assert(typeof provider.metadata === 'function', `${provider.name}: metadata()`);
  assert(typeof provider.validateTarget === 'function', `${provider.name}: validateTarget()`);
  assert(typeof provider.fetchJobs === 'function', `${provider.name}: fetchJobs()`);
  assert(typeof provider.search === 'function', `${provider.name}: search()`);
  assert(typeof provider.normalize === 'function', `${provider.name}: normalize()`);
  assert(typeof provider.healthCheck === 'function', `${provider.name}: healthCheck()`);
  assert(typeof provider.discover === 'function', `${provider.name}: discover()`);

  const meta = provider.metadata();
  assert(meta.name === provider.name, `${provider.name}: metadata.name`);
  assert(meta.atsType, `${provider.name}: metadata.atsType`);
  assert(typeof meta.implemented === 'boolean', `${provider.name}: metadata.implemented`);
  assert(meta.targetKind, `${provider.name}: metadata.targetKind`);

  const bad = provider.validateTarget('');
  assert(bad.valid === false, `${provider.name}: rejects empty target`);

  if (provider.metadata().targetKind === 'connection_payload') {
    const invalidPayload = provider.validateTarget({ boardToken: 'x', connectionPayload: {} });
    assert(invalidPayload.valid === false, `${provider.name}: rejects invalid payload target`);
  } else {
    const good = provider.validateTarget('stripe');
    assert(good.valid === true, `${provider.name}: accepts slug target`);
  }

  const discovered = provider.discover();
  assert(Array.isArray(discovered), `${provider.name}: discover() returns array`);
}

async function testLiveProviderFetch(provider) {
  const result = await provider.fetchJobs({}, { page: 1, limit: 5 });
  assert(result.jobs !== undefined, `${provider.name}: fetchJobs returns jobs`);
  assert(Array.isArray(result.jobs), `${provider.name}: jobs is array`);

  const viaSearch = await provider.search({}, { page: 1, limit: 3 });
  assert(Array.isArray(viaSearch.jobs), `${provider.name}: search() alias works`);
}

async function testProviderRunner(provider) {
  const result = await runProviderSearch(provider, {}, {});
  assert(Array.isArray(result.jobs), `${provider.name}: runProviderSearch jobs array`);
  assert(typeof result.durationMs === 'number', `${provider.name}: durationMs set`);
}

async function main() {
  console.log('\n── Provider plugin framework test (Phase 2A) ──');
  getDb();
  seedSourcesIfEmpty();
  importFromSourceTargets();

  const allMeta = getAllProviderMetadata();
  assert(allMeta.length >= 10, 'registry lists all provider metadata');
  console.log(`  ✓ ${allMeta.length} providers registered`);

  assert(validateBoardTokenTarget('airbnb').valid, 'validateBoardTokenTarget helper');
  assert(!validateBoardTokenTarget('  ').valid, 'validateBoardTokenTarget rejects blank');

  const allProviders = createAllProviders();
  for (const provider of allProviders) {
    testContractMethods(provider);
  }
  console.log(`  ✓ contract methods on ${allProviders.length} providers`);

  const active = createActiveProviders();
  assert(active.length >= 4, 'active providers include live sources');
  console.log(`  ✓ ${active.length} active providers`);

  for (const name of LIVE_PROVIDERS) {
    const provider = active.find((p) => p.name === name);
    assert(provider, `active provider: ${name}`);
    assert(provider.metadata().implemented === true, `${name} marked implemented`);
    await testLiveProviderFetch(provider);
    await testProviderRunner(provider);
    console.log(`  ✓ ${name}: fetchJobs + runProviderSearch (mock)`);
  }

  const gh = active.find((p) => p.name === 'greenhouse');
  const targets = gh.discover();
  if (targets.length > 0) {
    const health = await gh.healthCheck(targets[0].boardToken);
    assert(typeof health.ok === 'boolean', 'healthCheck returns ok boolean');
    console.log(`  ✓ greenhouse healthCheck on ${targets[0].boardToken}: ok=${health.ok}`);
  }

  const workday = allProviders.find((p) => p.name === 'workday');
  assert(workday.metadata().targetKind === 'connection_payload', 'workday target kind');
  assert(workday.metadata().implemented === true, 'workday implemented');
  const mockResult = await workday.fetchJobs({}, { page: 1, limit: 3 });
  assert(Array.isArray(mockResult.jobs), 'workday mock fetchJobs');
  console.log('  ✓ workday provider mock fetch');

  console.log('\n── summary: Phase 2A provider framework passed ──\n');
}

main().catch((err) => {
  console.error('\nProvider framework test failed:', err.message);
  process.exit(1);
});
