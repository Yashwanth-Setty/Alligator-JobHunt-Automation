/**
 * Smoke test for Company Registry HTTP API (Phase 1D).
 * Run: npm run test:registry-api
 */

import express from 'express';
import { getDb } from '../src/db/database.js';
import registryRoutes from '../src/routes/registry.routes.js';
import {
  cleanupTestRegistryData,
  TEST_REGISTRY_PREFIX,
} from '../src/services/companyRegistry/registryStore.js';
import { importFromSourceTargets } from '../src/services/companyRegistry/registryImport.js';
import { seedSourcesIfEmpty } from '../src/services/sourceStore.js';

const TEST_COMPANY_NAME = `${TEST_REGISTRY_PREFIX} API Test Co`;
const TEST_BOARD_TOKEN = `${TEST_REGISTRY_PREFIX}api-test-co`;

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

let server;
let baseUrl;

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use('/api/registry', registryRoutes);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}/api/registry`;
}

async function stopTestServer() {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function api(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log('\n── Company Registry Phase 1D API test ──');
  getDb();
  cleanupTestRegistryData();
  seedSourcesIfEmpty();
  importFromSourceTargets();

  await startTestServer();

  let companyId;
  let entryId;

  try {
    const tags = await api('GET', '/tags');
    assert(tags.status === 200, 'GET /tags status');
    assert(Array.isArray(tags.data.tags), 'GET /tags returns tags array');
    assert(tags.data.tags.length >= 8, 'GET /tags has seeded tags');
    console.log(`  ✓ GET /tags (${tags.data.tags.length} tags)`);

    const statsBefore = await api('GET', '/stats/summary');
    assert(statsBefore.status === 200, 'GET /stats/summary status');
    assert(typeof statsBefore.data.totalCompanies === 'number', 'stats totalCompanies');
    assert(Array.isArray(statsBefore.data.entriesBySource), 'stats entriesBySource');
    console.log(
      `  ✓ GET /stats/summary (${statsBefore.data.totalCompanies} companies, ${statsBefore.data.totalEntries} entries)`
    );

    const createCompany = await api('POST', '/companies', {
      name: TEST_COMPANY_NAME,
      domain: 'test.invalid',
      industry: 'Testing',
      tags: ['startup'],
    });
    assert(createCompany.status === 201, 'POST /companies status');
    assert(createCompany.data.company?.id, 'POST /companies returns company');
    companyId = createCompany.data.company.id;
    console.log('  ✓ POST /companies');

    const listCompanies = await api('GET', `/companies?search=${encodeURIComponent(TEST_REGISTRY_PREFIX)}`);
    assert(listCompanies.status === 200, 'GET /companies status');
    assert(
      listCompanies.data.companies.some((c) => c.id === companyId),
      'GET /companies finds test company'
    );
    console.log(`  ✓ GET /companies (${listCompanies.data.total} match)`);

    const createEntry = await api('POST', '/entries', {
      companyId,
      source: 'greenhouse',
      boardToken: TEST_BOARD_TOKEN,
      priority: 42,
      enabled: true,
    });
    assert(createEntry.status === 201, 'POST /entries status');
    assert(createEntry.data.entry?.id, 'POST /entries returns entry');
    entryId = createEntry.data.entry.id;
    assert(createEntry.data.entry.boardToken === TEST_BOARD_TOKEN, 'entry board token');
    console.log('  ✓ POST /entries');

    const listEntries = await api('GET', `/entries?source=greenhouse&companyId=${companyId}`);
    assert(listEntries.status === 200, 'GET /entries status');
    assert(
      listEntries.data.entries.some((e) => e.id === entryId),
      'GET /entries includes created entry'
    );
    console.log(`  ✓ GET /entries (${listEntries.data.total} for filters)`);

    const patchEntry = await api('PATCH', `/entries/${entryId}`, { priority: 88 });
    assert(patchEntry.status === 200, 'PATCH /entries/:id status');
    assert(patchEntry.data.entry?.priority === 88, 'PATCH updates priority');
    console.log('  ✓ PATCH /entries/:id');

    const toggleOff = await api('POST', `/entries/${entryId}/toggle`, { enabled: false });
    assert(toggleOff.status === 200, 'POST /entries/:id/toggle status');
    assert(toggleOff.data.entry?.enabled === false, 'toggle disables entry');
    console.log('  ✓ POST /entries/:id/toggle (disable)');

    const toggleOn = await api('POST', `/entries/${entryId}/toggle`);
    assert(toggleOn.status === 200, 'POST /entries/:id/toggle flip status');
    assert(toggleOn.data.entry?.enabled === true, 'toggle flips entry on');
    console.log('  ✓ POST /entries/:id/toggle (flip)');

    const badWorkday = await api('POST', '/entries', {
      companyId,
      source: 'workday',
      boardToken: 'acme',
    });
    assert(badWorkday.status === 400, 'POST /entries rejects workday without payload');
    console.log('  ✓ POST /entries rejects invalid workday payload');

    const notFound = await api('PATCH', '/entries/not-a-real-id', { priority: 1 });
    assert(notFound.status === 404, 'PATCH /entries/:id 404 for missing entry');
    console.log('  ✓ PATCH /entries/:id returns 404 when missing');

    console.log('\n── summary: Phase 1D API tests passed ──\n');
  } finally {
    cleanupTestRegistryData();
    await stopTestServer();
    console.log('  ✓ test registry data cleaned up');
  }
}

main().catch((err) => {
  console.error('\nRegistry API test failed:', err.message);
  process.exit(1);
});
