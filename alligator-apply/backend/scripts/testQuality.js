/**
 * Quality validation tests — dedupe, visa signals, filtering, normalization.
 * Run: npm run test:quality
 */
import { dedupeJobsWithStats } from '../src/sources/dedupe.js';
import { detectVisaSignals, mapLegacyVisaFit } from '../src/sources/visaSignals.js';
import { filterJobs } from '../src/sources/utils.js';
import { filterJobsWithStats } from '../src/sources/jobFetchFilter.js';
import { legacyMockToJob } from '../src/sources/types.js';
import { normalizeCompany, normalizeTitle, titlesAreSimilar } from '../src/sources/normalize.js';
import { calculateQualityScore } from '../src/sources/qualityScore.js';
import { GreenhouseAdapter } from '../src/sources/greenhouse.adapter.js';
import { isBroadCountryLocation } from '../src/services/locationService.js';
import { buildJobWhereClause } from '../src/services/jobQuery.js';

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

function testDedupe() {
  console.log('\n── dedupe ──');
  const jobs = [
    { id: '1', company: 'Acme Corp', title: 'Software Engineer', location: 'Remote', applyUrl: 'https://a.com/1', source: 'greenhouse' },
    { id: '2', company: 'Acme Corporation', title: 'Software Engineer', location: 'Remote', applyUrl: 'https://a.com/2', source: 'greenhouse' },
    { id: '3', company: 'Beta Inc', title: 'Data Analyst', location: 'NYC', applyUrl: 'https://b.com/1', source: 'lever' },
  ];
  const { jobs: out, removed } = dedupeJobsWithStats(jobs);
  assert(removed >= 1, 'fuzzy company+title+location dedupe removes similar job');
  assert(out.length === 2, 'deduped count is 2');

  const sameUrl = [
    { id: 'a', company: 'X', title: 'Dev', location: 'US', applyUrl: 'https://jobs.com/1/', source: 'lever' },
    { id: 'b', company: 'Y', title: 'Other', location: 'EU', applyUrl: 'https://jobs.com/1', source: 'ashby' },
  ];
  const r2 = dedupeJobsWithStats(sameUrl);
  assert(r2.removed === 1, 'same applyUrl is always duplicate');
}

function testVisa() {
  console.log('\n── visa signals ──');
  const pos = detectVisaSignals('We offer visa sponsorship and welcome OPT/CPT candidates.');
  assert(pos.fit === 'positive', 'positive: sponsorship + OPT');

  const neg = detectVisaSignals('Must be authorized to work in the US without sponsorship. US citizens only.');
  assert(neg.fit === 'negative', 'negative: no sponsorship + citizens only');

  const unknown = detectVisaSignals('Join our engineering team to build great products.');
  assert(unknown.fit === 'unknown', 'unknown: no visa keywords');

  assert(mapLegacyVisaFit('cpt_friendly') === 'positive', 'legacy cpt_friendly → positive');
  assert(mapLegacyVisaFit('review') === 'negative', 'legacy review → negative');
}

function testFiltering() {
  console.log('\n── source filtering ──');
  const jobs = [
    legacyMockToJob({ id: 'mock-1', company: 'A', title: 'Backend Dev', source: 'greenhouse', remote_type: 'remote', score: 70, url: 'https://a.com/1' }),
    legacyMockToJob({ id: 'mock-2', company: 'B', title: 'Designer', source: 'lever', remote_type: 'onsite', score: 60, url: 'https://b.com/2' }),
  ];
  const filtered = filterJobs(jobs, { source: 'greenhouse', remoteType: 'remote' });
  assert(filtered.length === 1 && filtered[0].source === 'greenhouse', 'filter by source and remote');

  const unscored = [
    { title: 'Java Developer', company: 'Co', location: 'Remote', applyUrl: 'https://a.com', description: 'Spring Boot AWS', score: 0 },
    { title: 'Sales Rep', company: 'Co', location: 'NYC', applyUrl: 'https://b.com', description: 'quota', score: 0 },
  ];
  const fetchResult = filterJobsWithStats(unscored, { keywords: 'Java,Spring Boot,AWS', minScore: '50' }, { forFetch: true });
  assert(fetchResult.jobs.length === 1, 'fetch filter ignores minScore on unscored jobs');
  assert(fetchResult.jobs[0].title.includes('Java'), 'fetch filter splits comma keywords (any match)');
}

function testJobLocationFilters() {
  console.log('\n── job location filters ──');
  assert(isBroadCountryLocation('United States'), 'United States is broad country filter');
  assert(isBroadCountryLocation('USA'), 'USA is broad country filter');
  assert(isBroadCountryLocation('Remote - United States'), 'Remote - United States is broad');
  assert(!isBroadCountryLocation('Atlanta, GA'), 'city location is not broad');

  const broadClause = buildJobWhereClause({ location: 'United States', keywords: 'engineer' }, 'all');
  assert(!broadClause.whereSql.includes('normalized_location'), 'broad US skips location SQL');

  const cityClause = buildJobWhereClause({ location: 'Atlanta, GA' }, 'all');
  assert(cityClause.whereSql.includes('normalized_location') || cityClause.whereSql.includes('location'), 'city applies location SQL');
}

function testNormalization() {
  console.log('\n── normalization ──');
  assert(normalizeCompany('Acme Corp.') === normalizeCompany('ACME Corporation'), 'company normalization');
  assert(titlesAreSimilar('Senior Software Engineer', 'Software Engineer II'), 'fuzzy title similarity');

  const adapter = new GreenhouseAdapter();
  const job = adapter.normalize({
    title: 'Backend Engineer',
    company_name: 'Stripe',
    location: { name: 'Remote' },
    absolute_url: 'https://stripe.com/jobs/1',
    content: '<p>Visa sponsorship available</p>',
    updated_at: '2026-01-01',
  });
  assert(job.source === 'greenhouse' && job.atsType === 'greenhouse', 'source and atsType set');
  assert(job.applyUrl === 'https://stripe.com/jobs/1', 'applyUrl included');
  assert(job.rawData && job.company === 'Stripe', 'rawData and company');

  const quality = calculateQualityScore(job);
  assert(quality.score >= 60, 'quality score calculated for normalized job');
}

testDedupe();
testVisa();
testFiltering();
testJobLocationFilters();
testNormalization();

console.log(`\n── summary: ${passed} passed, ${failed} failed ──`);
if (failed > 0) process.exit(1);
