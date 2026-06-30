/**
 * Workday CXS helper tests (Phase 2B).
 * Run: npm run test:workday
 */

import {
  buildCxsJobDetailUrl,
  buildCxsJobsRequestBody,
  buildCxsJobsUrl,
  buildWorkdayApplyUrl,
  buildWorkdayBoardToken,
  buildWorkdayCareersUrlFromPayload,
  extractRequisitionId,
  resolveWorkdayTarget,
  validateWorkdayPayload,
  validateWorkdayTarget,
} from '../src/sources/workdayCxs.js';
import { WorkdayAdapter } from '../src/sources/workday.adapter.js';

const NVIDIA_PAYLOAD = {
  tenant: 'nvidia',
  wdInstance: 'wd5',
  hostSlug: 'nvidia',
  site: 'NVIDIAExternalCareerSite',
  locale: 'en-US',
  pageSize: 20,
};

const LISTING_FIXTURE = {
  title: 'Senior Software Engineer',
  externalPath: '/job/US-CA-Santa-Clara/Senior-Software-Engineer_JR2012345',
  locationsText: 'Santa Clara, CA',
  postedOn: 'Posted 2026-04-01',
  bulletFields: ['JR2012345'],
};

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

function main() {
  console.log('\n── Workday CXS helper tests ──');

  assert(validateWorkdayPayload(NVIDIA_PAYLOAD).valid, 'valid NVIDIA payload');
  assert(!validateWorkdayPayload({ tenant: 'x' }).valid, 'rejects incomplete payload');
  assert(!validateWorkdayPayload({ ...NVIDIA_PAYLOAD, wdInstance: 'bad' }).valid, 'rejects bad wdInstance');
  console.log('  ✓ payload validation');

  const target = {
    boardToken: buildWorkdayBoardToken('nvidia', 'NVIDIAExternalCareerSite'),
    companyName: 'NVIDIA',
    connectionPayload: NVIDIA_PAYLOAD,
  };
  const config = resolveWorkdayTarget(target);
  assert(config.tenant === 'nvidia', 'resolveWorkdayTarget tenant');
  assert(validateWorkdayTarget(target).valid, 'validateWorkdayTarget');

  const jobsUrl = buildCxsJobsUrl(config);
  assert(
    jobsUrl ===
      'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
    'buildCxsJobsUrl'
  );

  const detailUrl = buildCxsJobDetailUrl(config, LISTING_FIXTURE.externalPath);
  assert(detailUrl.includes('/job/US-CA-Santa-Clara/'), 'buildCxsJobDetailUrl');

  const careersUrl = buildWorkdayCareersUrlFromPayload(NVIDIA_PAYLOAD);
  assert(careersUrl.includes('/en-US/NVIDIAExternalCareerSite'), 'careers URL');

  const applyUrl = buildWorkdayApplyUrl(config, LISTING_FIXTURE.externalPath);
  assert(applyUrl.includes('myworkdayjobs.com'), 'apply URL host');

  const body = buildCxsJobsRequestBody({ keywords: 'engineer' }, config, 0);
  assert(body.limit === 20 && body.offset === 0, 'request body pagination');
  assert(body.searchText === 'engineer', 'request body searchText');
  assert(body.appliedFacets && typeof body.appliedFacets === 'object', 'appliedFacets object');
  console.log('  ✓ URL builders + request body');

  assert(extractRequisitionId(LISTING_FIXTURE) === 'JR2012345', 'requisition id');

  const adapter = new WorkdayAdapter();
  const job = adapter.normalize(
    { posting: LISTING_FIXTURE },
    { target, config }
  );
  assert(job.source === 'workday', 'normalized source');
  assert(job.company === 'NVIDIA', 'normalized company');
  assert(job.title === LISTING_FIXTURE.title, 'normalized title');
  assert(job.applyUrl.includes('myworkdayjobs.com'), 'normalized applyUrl');
  assert(job.autoApplyEligible === false, 'workday never auto-apply eligible');
  assert(job.id, 'normalized id');
  console.log('  ✓ normalization fixture');

  console.log('\n── summary: Workday CXS tests passed ──\n');
}

main();
