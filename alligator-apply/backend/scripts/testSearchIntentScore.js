/**
 * Tests for search-intent ranking.
 * Run: npm run test:search-intent
 */
import {
  computeSearchIntentScore,
  scoreAndSortJobRows,
  scoreLocationIntent,
} from '../src/services/searchIntentScore.js';

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

function job(overrides = {}) {
  return {
    title: 'Engineer',
    location: 'Remote, US',
    normalized_location: 'United States',
    description: '',
    remote_type: 'remote',
    score: 70,
    ...overrides,
  };
}

console.log('\n── Full Stack Java Developer keyword ranking ──');

const javaFilters = { keywords: 'Full Stack Java Developer' };

const javaDev = computeSearchIntentScore(
  job({ title: 'Senior Java Full Stack Developer', location: 'Remote US' }),
  javaFilters
);
const productEng = computeSearchIntentScore(
  job({ title: 'Product Engineer', location: 'Remote US' }),
  javaFilters
);
const customerEng = computeSearchIntentScore(
  job({ title: 'Customer Engineer', location: 'San Francisco, CA' }),
  javaFilters
);
const softwareEng = computeSearchIntentScore(
  job({ title: 'Software Engineer - Java Spring', location: 'Remote, United States' }),
  javaFilters
);

assert(javaDev.searchIntentScore > productEng.searchIntentScore, 'Java Full Stack beats Product Engineer');
assert(javaDev.searchIntentScore > customerEng.searchIntentScore, 'Java Full Stack beats Customer Engineer');
assert(softwareEng.searchIntentScore > productEng.searchIntentScore, 'Software Engineer Java beats Product Engineer');
assert(
  javaDev.searchIntentReasons.some((r) => r.startsWith('boost:') || r.includes('java')),
  'Java role gets boost reasons'
);
assert(
  productEng.searchIntentReasons.some((r) => r.startsWith('penalty:')),
  'Product Engineer gets penalty reason'
);

const ranked = scoreAndSortJobRows(
  [
    job({ id: '1', title: 'Product Engineer', score: 90 }),
    job({ id: '2', title: 'Full Stack Java Developer', score: 75 }),
    job({ id: '3', title: 'Account Executive', score: 85 }),
    job({ id: '4', title: 'Backend Software Engineer - Java', score: 70 }),
  ].map((row) => ({ ...row })),
  javaFilters
);

assert(
  ranked[0].row.title.includes('Java') || ranked[0].row.title.includes('Software'),
  `top result is role-relevant (${ranked[0].row.title})`
);
assert(
  !/product engineer|account executive/i.test(ranked[0].row.title),
  'top result is not Product/Account role'
);

console.log('\n── Tampa, FL location ranking ──');

const tampaFilters = { keywords: 'Full Stack Java Developer', location: 'Tampa, FL' };

const tampaJob = computeSearchIntentScore(
  job({ title: 'Java Developer', location: 'Tampa, FL' }),
  tampaFilters
);
const floridaRemote = computeSearchIntentScore(
  job({ title: 'Java Developer', location: 'Remote, Florida, US' }),
  tampaFilters
);
const sfJob = computeSearchIntentScore(
  job({ title: 'Java Developer', location: 'San Francisco, CA' }),
  tampaFilters
);
const europeJob = computeSearchIntentScore(
  job({ title: 'Java Developer', location: 'Berlin, Europe' }),
  tampaFilters
);
const remoteUs = computeSearchIntentScore(
  job({ title: 'Java Developer', location: 'Remote, United States' }),
  tampaFilters
);

assert(tampaJob.searchIntentScore > sfJob.searchIntentScore, 'Tampa job beats SF for Tampa search');
assert(tampaJob.searchIntentScore > europeJob.searchIntentScore, 'Tampa job beats Europe for Tampa search');
assert(remoteUs.searchIntentScore > europeJob.searchIntentScore, 'Remote US beats Europe for Tampa search');
assert(
  tampaJob.searchIntentReasons.includes('location_city_exact'),
  'Tampa job has location_city_exact reason'
);

const locRanked = scoreAndSortJobRows(
  [
    job({ id: 'a', title: 'Java Dev', location: 'San Francisco, CA' }),
    job({ id: 'b', title: 'Java Dev', location: 'Berlin, Europe' }),
    job({ id: 'c', title: 'Java Dev', location: 'Remote, United States' }),
    job({ id: 'd', title: 'Java Dev', location: 'Tampa, FL' }),
  ],
  tampaFilters
);

assert(/tampa/i.test(locRanked[0].row.location), `Tampa ranks first (${locRanked[0].row.location})`);
assert(
  locRanked.findIndex((r) => /europe|berlin/i.test(r.row.location))
    > locRanked.findIndex((r) => /tampa|remote.*united states/i.test(r.row.location)),
  'Europe ranks below Tampa/Remote US'
);

console.log('\n── location intent tiers ──');

const tampaLoc = scoreLocationIntent('Tampa, FL', 'United States', 'Tampa, FL');
const sfLoc = scoreLocationIntent('San Francisco, CA', 'United States', 'Tampa, FL');
assert(tampaLoc.points > sfLoc.points, 'location_city_exact scores higher than SF for Tampa query');
assert(tampaLoc.tier === 'city', 'Tampa match tier is city');

console.log('\n── AI Engineer search: AI roles outrank generic Dallas SWE ──');

const aiSearchFilters = { keywords: 'AI Engineer', location: 'Dallas, TX' };

// Generic Texas SW engineer — gets state(30) + us(16) + fuzzy(8) + engineer title(20) = ~74.
// Using Irving, TX so it does NOT trigger location_city_exact for "dallas" search.
const genericDallasSWE = computeSearchIntentScore(
  job({ title: 'Sr. SW Engineer', location: 'Irving, TX, United States', normalized_location: 'United States' }),
  aiSearchFilters
);

// SF AI jobs — set normalized_location:'' so they only get the small location_sf(4) bonus,
// matching what real scans produce for SF-only postings vs a Dallas search.
const seniorAIEngSF = computeSearchIntentScore(
  job({ title: 'Senior AI Engineer', location: 'San Francisco, CA', normalized_location: '' }),
  aiSearchFilters
);
const mlEngineerSF = computeSearchIntentScore(
  job({ title: 'Machine Learning Engineer', location: 'San Francisco, CA', normalized_location: '' }),
  aiSearchFilters
);
const researchSciSF = computeSearchIntentScore(
  job({ title: 'Research Scientist', location: 'San Francisco, CA', normalized_location: '' }),
  aiSearchFilters
);
const appliedSciSF = computeSearchIntentScore(
  job({ title: 'Applied Scientist', location: 'San Francisco, CA', normalized_location: '' }),
  aiSearchFilters
);
const llmEngSF = computeSearchIntentScore(
  job({ title: 'LLM Engineer', location: 'San Francisco, CA', normalized_location: '' }),
  aiSearchFilters
);

assert(
  seniorAIEngSF.searchIntentScore > genericDallasSWE.searchIntentScore,
  `Senior AI Engineer (SF) outranks Sr. SW Engineer (Dallas) [${seniorAIEngSF.searchIntentScore} > ${genericDallasSWE.searchIntentScore}]`
);
assert(
  mlEngineerSF.searchIntentScore > genericDallasSWE.searchIntentScore,
  `Machine Learning Engineer (SF) outranks Sr. SW Engineer (Dallas) [${mlEngineerSF.searchIntentScore} > ${genericDallasSWE.searchIntentScore}]`
);
assert(
  researchSciSF.searchIntentScore > genericDallasSWE.searchIntentScore,
  `Research Scientist (SF) outranks Sr. SW Engineer (Dallas) [${researchSciSF.searchIntentScore} > ${genericDallasSWE.searchIntentScore}]`
);
assert(
  appliedSciSF.searchIntentScore > genericDallasSWE.searchIntentScore,
  `Applied Scientist (SF) outranks Sr. SW Engineer (Dallas) [${appliedSciSF.searchIntentScore} > ${genericDallasSWE.searchIntentScore}]`
);
assert(
  llmEngSF.searchIntentScore > genericDallasSWE.searchIntentScore,
  `LLM Engineer (SF) outranks Sr. SW Engineer (Dallas) [${llmEngSF.searchIntentScore} > ${genericDallasSWE.searchIntentScore}]`
);
assert(
  seniorAIEngSF.searchIntentReasons.some((r) => r === 'boost:ai_role'),
  'Senior AI Engineer gets boost:ai_role reason'
);
assert(
  researchSciSF.searchIntentReasons.some((r) => r === 'boost:research_scientist'),
  'Research Scientist gets boost:research_scientist reason'
);

console.log('\n── AI Engineer search: non-AI behavior unchanged ──');

const javaSearchFilters = { keywords: 'Java Backend Developer', location: 'Dallas, TX' };
const sweDallasJava = computeSearchIntentScore(
  job({ title: 'Sr. SW Engineer', location: 'Irving, TX, United States', normalized_location: 'United States' }),
  javaSearchFilters
);
const aiEngJava = computeSearchIntentScore(
  job({ title: 'Senior AI Engineer', location: 'San Francisco, CA', normalized_location: '' }),
  javaSearchFilters
);

assert(
  sweDallasJava.searchIntentScore > aiEngJava.searchIntentScore,
  `Java search unchanged: Dallas SW Eng beats SF AI Eng [${sweDallasJava.searchIntentScore} > ${aiEngJava.searchIntentScore}]`
);
assert(
  !aiEngJava.searchIntentReasons.some((r) => r === 'boost:ai_role'),
  'No ai_role boost applied for non-AI search'
);

console.log('\n── ML/LLM intent also triggers AI boosts ──');

const mlSearchFilters = { keywords: 'Machine Learning Engineer' };
const mlEngML = computeSearchIntentScore(
  job({ title: 'Machine Learning Engineer' }),
  mlSearchFilters
);
const swEngML = computeSearchIntentScore(
  job({ title: 'Software Engineer' }),
  mlSearchFilters
);
assert(
  mlEngML.searchIntentScore > swEngML.searchIntentScore,
  `ML Engineer beats SW Engineer for ML search [${mlEngML.searchIntentScore} > ${swEngML.searchIntentScore}]`
);
assert(
  mlEngML.searchIntentReasons.some((r) => r === 'boost:ml_role'),
  'ML Engineer gets boost:ml_role for ML search'
);

console.log(`\n── summary: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
