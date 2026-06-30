#!/usr/bin/env node
/**
 * Early fetch filter tests — permissive adapter-stage filtering.
 * Run: npm run test:early-filter
 */

import {
  passesEarlyFilter,
  isBroadKeywordQuery,
  expandEarlyFilterTerms,
  matchesPermissiveKeywordFilter,
  passesPermissiveLocationFilter,
} from '../src/sources/earlyFilter.js';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`);
  }
}

const stripeLikeJobs = [
  { title: 'Account Executive, AI Sales (Grower)', location: { name: 'Remote - US' } },
  { title: 'Account Executive - Enterprise, Grower', location: { name: 'San Francisco, CA' } },
  { title: 'Senior Java Backend Engineer', location: { name: 'Seattle, WA' } },
  { title: 'Software Engineer, Full Stack', location: { name: 'New York, NY' } },
  { title: 'Partner Marketing Manager', location: { name: 'London, UK' } },
];

const keywordFilters = {
  keywords: 'Full Stack Java Developer',
  location: 'United States',
};

console.log('\n── early filter: keyword expansion ──');
assert(isBroadKeywordQuery('Full Stack Java Developer'), 'Full Stack Java Developer is broad role query');
assert(
  expandEarlyFilterTerms('Full Stack Java Developer').includes('java'),
  'expands java term'
);
assert(
  expandEarlyFilterTerms('Full Stack Java Developer').includes('full stack'),
  'expands full stack term'
);

console.log('\n── early filter: Full Stack Java Developer + United States ──');
const filtered = stripeLikeJobs.filter((job) =>
  passesEarlyFilter(job, keywordFilters, 'greenhouse')
);
assert(filtered.length > 0, `"Full Stack Java Developer" does not drop all Stripe-like jobs (${filtered.length}/${stripeLikeJobs.length})`);
assert(
  stripeLikeJobs.filter((j) => passesEarlyFilter(j, keywordFilters, 'greenhouse')).length ===
    stripeLikeJobs.length,
  'broad role query allows non-matching titles through for scoring'
);

console.log('\n── early filter: United States location ──');
assert(
  passesEarlyFilter(
    { title: 'Engineer', location: { name: 'Remote - United States' } },
    { location: 'United States' },
    'greenhouse'
  ),
  'Remote - United States passes United States filter'
);
assert(
  passesEarlyFilter(
    { title: 'Engineer', location: { name: 'San Francisco, CA' } },
    { location: 'United States' },
    'greenhouse'
  ),
  'US city passes United States filter'
);
assert(
  passesPermissiveLocationFilter('Remote - US', 'United States', 'United States'),
  'passesPermissiveLocationFilter allows US remote'
);

console.log('\n── early filter: no-filter unchanged ──');
assert(
  passesEarlyFilter({ title: 'Anything', location: { name: 'Paris, France' } }, {}, 'greenhouse'),
  'empty filters pass all jobs'
);
assert(
  passesEarlyFilter({ title: 'Anything' }, { keywords: '' }, 'greenhouse'),
  'empty keyword passes'
);

console.log('\n── early filter: specific city conflict ──');
assert(
  !passesEarlyFilter(
    { title: 'Engineer', location: { name: 'London, UK' } },
    { location: 'Dallas, TX' },
    'greenhouse'
  ),
  'clear international conflict rejected for specific city filter'
);

console.log('\n── early filter: meaningful term match for narrow query ──');
assert(
  matchesPermissiveKeywordFilter('senior kubernetes administrator', 'Kubernetes SRE'),
  'narrow query matches related title term'
);
assert(
  !matchesPermissiveKeywordFilter('account executive sales', 'Kubernetes SRE'),
  'narrow unrelated query still rejects unrelated title'
);

console.log('\n── AI search: _aiLocationBypass flag ──');

const sfAIJob = { title: 'AI Engineer', location: { name: 'San Francisco, CA' } };
const dallasMixedFilters = { keywords: 'AI Engineer', location: 'Dallas, TX' };

// US-to-US location: earlyFilter is permissive by design (no hasClearLocationConflict for same-country)
assert(
  passesEarlyFilter(sfAIJob, dallasMixedFilters, 'greenhouse'),
  'SF AI job already passes Dallas filter (US-to-US is permissive)'
);
assert(
  passesEarlyFilter(sfAIJob, { ...dallasMixedFilters, _aiLocationBypass: true }, 'greenhouse'),
  'SF AI job passes with _aiLocationBypass=true'
);
// International jobs ARE still blocked without bypass
assert(
  !passesEarlyFilter(
    { title: 'AI Engineer', location: { name: 'London, UK' } },
    dallasMixedFilters,
    'greenhouse'
  ),
  'UK AI job rejected for Dallas filter without bypass (international conflict)'
);
// Bypass overrides even international conflicts
assert(
  passesEarlyFilter(
    { title: 'AI Engineer', location: { name: 'London, UK' } },
    { ...dallasMixedFilters, _aiLocationBypass: true },
    'greenhouse'
  ),
  'UK AI job passes Dallas filter with _aiLocationBypass=true'
);
assert(
  passesEarlyFilter(
    { title: 'AI Engineer', location: { name: 'Remote, US' } },
    dallasMixedFilters,
    'greenhouse'
  ),
  'Remote US AI job passes Dallas filter (remote always passes)'
);

console.log(`\n── summary: ${passed} passed, ${failed} failed ──\n`);
process.exit(failed > 0 ? 1 : 0);
