/**
 * Debug script: run multiple different keyword+location searches against the same
 * sample job pool and print the top-5 results per search.
 * Confirms that different searches produce meaningfully different rankings.
 *
 * Run: npm run debug:rank-searches
 */
import { scoreAndSortJobRows } from '../src/services/searchIntentScore.js';

function job(id, title, location, normalizedLocation = 'United States', remoteType = 'onsite', score = 70) {
  return { id, title, location, normalized_location: normalizedLocation, description: '', remote_type: remoteType, score };
}

const SAMPLE_JOBS = [
  job('j1',  'Senior Java Full Stack Developer',         'Tampa, FL',                   'United States'),
  job('j2',  'Java Backend Engineer',                    'Remote, United States',        'United States', 'remote'),
  job('j3',  'React Frontend Developer',                 'New York, NY',                 'United States'),
  job('j4',  'Senior React Engineer',                    'Remote, US',                   'United States', 'remote'),
  job('j5',  'Product Engineer',                         'San Francisco, CA',            'United States'),
  job('j6',  'Customer Engineer',                        'Austin, TX',                   'United States'),
  job('j7',  'Account Executive',                        'Chicago, IL',                  'United States'),
  job('j8',  'Python Data Engineer',                     'Seattle, WA',                  'United States'),
  job('j9',  'Data Scientist - Python/ML',               'Remote, United States',        'United States', 'remote'),
  job('j10', 'Software Engineer - Java Spring Boot',     'Orlando, FL',                  'United States'),
  job('j11', 'Full Stack Developer (React + Node)',      'Remote, United States',        'United States', 'remote'),
  job('j12', 'Node.js Backend Developer',                'Tampa, FL',                    'United States'),
  job('j13', 'Java Spring Microservices Developer',      'Berlin, Europe',               'Europe'),
  job('j14', 'Frontend React Developer',                 'Remote - Europe',              'Europe', 'remote'),
  job('j15', 'Solutions Architect',                      'New York, NY',                 'United States'),
  job('j16', 'Software Engineer - Python',               'Remote, United States',        'United States', 'remote'),
  job('j17', 'Full Stack Java Backend Developer',        'Tampa, FL',                    'United States'),
  job('j18', 'Senior React Frontend Developer',          'New York, NY',                 'United States'),
];

const SEARCHES = [
  { label: 'Full Stack Java Developer — Tampa, FL', filters: { keywords: 'Full Stack Java Developer', location: 'Tampa, FL' } },
  { label: 'React Developer — New York, NY',        filters: { keywords: 'React Developer',           location: 'New York, NY' } },
  { label: 'Python Data Engineer — Remote US',      filters: { keywords: 'Python Data Engineer',      location: 'United States' } },
  { label: 'Node.js Backend Developer — Tampa, FL', filters: { keywords: 'Node.js Backend Developer', location: 'Tampa, FL' } },
];

let allPass = true;

for (const { label, filters } of SEARCHES) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Search: "${label}"`);
  console.log('─'.repeat(60));

  const ranked = scoreAndSortJobRows(SAMPLE_JOBS, filters);
  const top5 = ranked.slice(0, 5);

  top5.forEach((r, i) => {
    const reasons = r.searchIntentReasons.join(', ') || '(none)';
    console.log(`  #${i + 1} [${r.searchIntentScore.toString().padStart(3)}] ${r.row.title} — ${r.row.location}`);
    console.log(`        reasons: ${reasons}`);
  });

  // Verify: top result should not be a clearly off-role title
  const topTitle = top5[0]?.row?.title || '';
  const offRole = /product engineer|customer engineer|account executive|solutions architect/i.test(topTitle);
  if (offRole) {
    console.error(`  ✗ FAIL: top result is an off-role title: "${topTitle}"`);
    allPass = false;
  } else {
    console.log(`  ✓ top result is role-relevant: "${topTitle}"`);
  }
}

// Cross-search check: top-5 job IDs for Java search vs React search should differ
console.log(`\n${'─'.repeat(60)}`);
console.log('Cross-search differentiation check');
console.log('─'.repeat(60));

const javaRanked = scoreAndSortJobRows(SAMPLE_JOBS, SEARCHES[0].filters).slice(0, 5).map(r => r.row.id);
const reactRanked = scoreAndSortJobRows(SAMPLE_JOBS, SEARCHES[1].filters).slice(0, 5).map(r => r.row.id);
const overlap = javaRanked.filter(id => reactRanked.includes(id)).length;
const differentEnough = overlap <= 2;

console.log(`  Java top-5 IDs:  ${javaRanked.join(', ')}`);
console.log(`  React top-5 IDs: ${reactRanked.join(', ')}`);
console.log(`  Overlap: ${overlap}/5 jobs in common`);

if (differentEnough) {
  console.log(`  ✓ Searches produce different top results (overlap=${overlap})`);
} else {
  console.error(`  ✗ FAIL: too much overlap between Java and React searches (${overlap}/5)`);
  allPass = false;
}

console.log(`\n${'═'.repeat(60)}`);
console.log(allPass ? '✓  All rank-search checks passed' : '✗  Some checks FAILED');
console.log('═'.repeat(60));
process.exit(allPass ? 0 : 1);
