/**
 * Seed Workday registry entries (Phase 2B).
 * Run: npm run registry:seed:workday
 */

import { getDb } from '../src/db/database.js';
import {
  findOrCreateCompany,
  upsertRegistryEntry,
} from '../src/services/companyRegistry/registryStore.js';
import {
  buildWorkdayBoardToken,
  buildWorkdayCareersUrlFromPayload,
} from '../src/sources/workdayCxs.js';

const WORKDAY_SEED = [
  {
    company: { name: 'NVIDIA', industry: 'Semiconductors', tags: ['ai', 'enterprise'] },
    payload: {
      tenant: 'nvidia',
      wdInstance: 'wd5',
      hostSlug: 'nvidia',
      site: 'NVIDIAExternalCareerSite',
      locale: 'en-US',
      pageSize: 20,
      fetchDetails: false,
    },
    priority: 80,
  },
  {
    company: { name: 'Salesforce', industry: 'Enterprise Software', tags: ['enterprise', 'faang'] },
    payload: {
      tenant: 'salesforce',
      wdInstance: 'wd12',
      hostSlug: 'salesforce',
      site: 'External_Career_Site',
      locale: 'en-US',
    },
    priority: 75,
  },
  {
    company: { name: 'Adobe', industry: 'Software', tags: ['enterprise'] },
    payload: {
      tenant: 'adobe',
      wdInstance: 'wd5',
      hostSlug: 'adobe',
      site: 'external_experienced',
      locale: 'en-US',
    },
    priority: 70,
  },
  {
    company: { name: 'ServiceNow', industry: 'Enterprise Software', tags: ['enterprise'] },
    payload: {
      tenant: 'servicenow',
      wdInstance: 'wd1',
      hostSlug: 'servicenow',
      site: 'careers',
      locale: 'en-US',
    },
    priority: 65,
  },
  {
    company: { name: 'Netflix', industry: 'Entertainment', tags: ['faang', 'remote_first'] },
    payload: {
      tenant: 'netflix',
      wdInstance: 'wd1',
      hostSlug: 'netflix',
      site: 'External',
      locale: 'en-US',
    },
    priority: 60,
  },
];

function main() {
  getDb();

  let created = 0;
  let updated = 0;

  for (const row of WORKDAY_SEED) {
    const { company, payload, priority } = row;
    const boardToken = buildWorkdayBoardToken(payload.tenant, payload.site);
    const careersUrl = buildWorkdayCareersUrlFromPayload(payload);

    const { company: companyRow, created: companyCreated } = findOrCreateCompany({
      name: company.name,
      industry: company.industry || '',
    });

    if (companyCreated) created += 1;

    const { action } = upsertRegistryEntry({
      companyId: companyRow.id,
      source: 'workday',
      boardToken,
      careersUrl,
      connectionPayload: payload,
      priority: priority ?? 50,
      enabled: true,
    });

    if (action === 'created') created += 1;
    else updated += 1;

    console.log(`  ✓ ${company.name} → ${boardToken}`);
  }

  console.log('\n── Workday registry seed complete ──');
  console.log(`  entries created/updated: ${created} created ops, ${updated} updated`);
  console.log('  Note: Workday scans only when JOB_SOURCES includes workday.\n');
}

main();
