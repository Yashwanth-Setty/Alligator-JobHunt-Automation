/**
 * Ranking breakdown diagnostic.
 * Connects to the live SQLite DB (no server needed) and answers:
 *   A) Were Java jobs fetched at all?
 *   B) Were they ranked too low?
 *   C) Did the query reach computeSearchIntentScore correctly?
 *   D) Is the final ranked order correct before response?
 *
 * Usage:
 *   npm run debug:ranking-breakdown -- --keywords "Java Backend Developer" --location "Dallas, TX"
 *   npm run debug:ranking-breakdown -- --keywords "Java Backend Developer" --location "Dallas, TX" --scanRunId <id>
 */

import { getDb } from '../src/db/database.js';
import { resolveActiveScanRunId, scanFiltersSignature } from '../src/services/scanMetrics.js';
import { computeSearchIntentScore } from '../src/services/searchIntentScore.js';

// ── parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const keywords = getArg('keywords') || '';
const location  = getArg('location')  || '';
const explicitScanRunId = getArg('scanRunId') || null;

if (!keywords) {
  console.error('ERROR: --keywords is required');
  process.exit(1);
}

const filters = { keywords, location };

// ── resolve scanRunId ─────────────────────────────────────────────────────────
const db = getDb();

let scanRunId = explicitScanRunId;
if (!scanRunId) {
  scanRunId = resolveActiveScanRunId({ filters });
}

// Also try latest completed scan if nothing matched filters
if (!scanRunId) {
  const latest = db.prepare(`SELECT id, search_filters, status, started_at FROM scan_runs ORDER BY started_at DESC LIMIT 1`).get();
  if (latest) {
    console.warn(`[DIAG] No scan matched filters. Falling back to latest scan: ${latest.id} (${latest.status}, ${latest.started_at})`);
    console.warn(`[DIAG]   scan search_filters : ${latest.search_filters}`);
    console.warn(`[DIAG]   query sig           : ${scanFiltersSignature(filters)}`);
    scanRunId = latest.id;
  }
}

if (!scanRunId) {
  console.error('ERROR: No scan runs found in DB. Run a scan first.');
  process.exit(1);
}

// ── SECTION 1: verify the query ───────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('SECTION 1 — Query verification');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  keywords passed to this script : "${keywords}"`);
console.log(`  location passed to this script : "${location}"`);
console.log(`  resolved scanRunId             : ${scanRunId}`);

const scanRow = db.prepare('SELECT * FROM scan_runs WHERE id = ?').get(scanRunId);
console.log(`  scan status                    : ${scanRow?.status}`);
console.log(`  scan search_filters (stored)   : ${scanRow?.search_filters}`);
console.log(`  scan started_at                : ${scanRow?.started_at}`);
console.log(`  scan jobs_found                : ${scanRow?.jobs_found}`);

// Verify the stored signature matches what the UI would send
const expectedSig = scanFiltersSignature(filters);
const storedSig   = scanRow?.search_filters || '';
const sigMatch    = storedSig === expectedSig;
console.log(`  expected sig (from args)       : ${expectedSig}`);
console.log(`  sig match                      : ${sigMatch ? '✓ YES' : '✗ NO — scan was run with different filters'}`);

// ── SECTION 2: Java job presence in scan ─────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('SECTION 2 — Java job presence in this scan');
console.log('══════════════════════════════════════════════════════════════════');

const allJobsInScan = db.prepare(
  `SELECT id, title, company, location, normalized_location, score, remote_type, description FROM jobs
   WHERE scan_run_id = ? AND COALESCE(is_hidden,0)=0`
).all(scanRunId);

const totalInScan = allJobsInScan.length;
const javaByTitle = allJobsInScan.filter(j => /\bjava\b/i.test(j.title));
const javaByDesc  = allJobsInScan.filter(j => /\bjava\b/i.test(j.description || ''));
const javaAny     = [...new Map([...javaByTitle, ...javaByDesc].map(j => [j.id, j])).values()];
const backendByTitle = allJobsInScan.filter(j => /\bbackend\b/i.test(j.title));
const dallasByLoc    = allJobsInScan.filter(j => /\bdallas\b/i.test(`${j.location} ${j.normalized_location}`));

console.log(`  total jobs in scan             : ${totalInScan}`);
console.log(`  jobs with "java" in TITLE      : ${javaByTitle.length}`);
console.log(`  jobs with "java" in DESC       : ${javaByDesc.length}`);
console.log(`  jobs with "java" anywhere      : ${javaAny.length}`);
console.log(`  jobs with "backend" in TITLE   : ${backendByTitle.length}`);
console.log(`  jobs with "dallas" in location : ${dallasByLoc.length}`);

if (javaByTitle.length === 0) {
  console.log('\n  !! FINDING A: NO Java jobs have "java" in their title in this scan.');
} else {
  console.log(`\n  First 10 Java-in-title jobs:`);
  javaByTitle.slice(0, 10).forEach((j, i) =>
    console.log(`    [${i+1}] "${j.title}" — ${j.company} — ${j.location} (score=${j.score})`)
  );
}

if (javaByDesc.length > 0 && javaByTitle.length === 0) {
  console.log(`\n  First 10 Java-in-description jobs (not in title):`);
  javaByDesc.slice(0, 10).forEach((j, i) =>
    console.log(`    [${i+1}] "${j.title}" — ${j.company} — ${j.location} (score=${j.score})`)
  );
}

// ── SECTION 3: ranking breakdown for first 20 returned jobs ──────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('SECTION 3 — Intent scoring breakdown (all jobs in scan)');
console.log('══════════════════════════════════════════════════════════════════');
console.log(`  scoring with: keywords="${keywords}" location="${location}"`);
console.log(`  NOTE: If keywords show as "" here, the query is not reaching the scorer\n`);

const scored = allJobsInScan.map(row => {
  const { searchIntentScore, searchIntentReasons } = computeSearchIntentScore(row, { keywords, location });

  // Decompose contribution categories
  const kw       = searchIntentReasons.filter(r => r.startsWith('title_') || r.startsWith('desc_'));
  const javaR    = searchIntentReasons.filter(r => r === 'boost:java');
  const backendR = searchIntentReasons.filter(r => r === 'boost:backend');
  const locR     = searchIntentReasons.filter(r => r.startsWith('location_'));
  const boosts   = searchIntentReasons.filter(r => r.startsWith('boost:'));
  const penalties= searchIntentReasons.filter(r => r.startsWith('penalty:'));

  return { row, searchIntentScore, searchIntentReasons, kw, javaR, backendR, locR, boosts, penalties };
});

// Sort: searchIntentScore DESC, then matchScore DESC
scored.sort((a, b) => {
  if (b.searchIntentScore !== a.searchIntentScore) return b.searchIntentScore - a.searchIntentScore;
  return (b.row.score || 0) - (a.row.score || 0);
});

const top20 = scored.slice(0, 20);
top20.forEach((s, i) => {
  const r = s.row;
  console.log(`  #${String(i+1).padStart(2)} intentScore=${String(s.searchIntentScore).padStart(3)}  matchScore=${String(r.score||0).padStart(3)}  "${r.title}" — ${r.company} — ${r.location}`);
  console.log(`       kw hits   : ${s.kw.join(', ') || '(none)'}`);
  console.log(`       boosts    : ${s.boosts.join(', ') || '(none)'}`);
  console.log(`       java boost: ${s.javaR.length ? 'YES (+28)' : 'NO'}`);
  console.log(`       bknd boost: ${s.backendR.length ? 'YES (+22)' : 'NO'}`);
  console.log(`       location  : ${s.locR.join(', ') || '(none)'}`);
  console.log(`       penalties : ${s.penalties.join(', ') || '(none)'}`);
  console.log(`       all reasons: ${s.searchIntentReasons.join(' | ')}`);
});

// ── SECTION 4: specific comparison ───────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('SECTION 4 — Specific comparison: any Java job vs top non-Java job');
console.log('══════════════════════════════════════════════════════════════════');

const topJob = scored[0];
const topJavaJob = scored.find(s => /\bjava\b/i.test(s.row.title));
const topNonJavaJob = scored.find(s => !/\bjava\b/i.test(s.row.title));

console.log(`\n  TOP overall job:`);
console.log(`    title       : "${topJob?.row.title}"`);
console.log(`    company     : ${topJob?.row.company}`);
console.log(`    intentScore : ${topJob?.searchIntentScore}`);
console.log(`    matchScore  : ${topJob?.row.score}`);
console.log(`    reasons     : ${topJob?.searchIntentReasons.join(' | ')}`);

if (topJavaJob) {
  const javaRank = scored.indexOf(topJavaJob) + 1;
  console.log(`\n  Best Java-in-title job (rank #${javaRank}):`);
  console.log(`    title       : "${topJavaJob.row.title}"`);
  console.log(`    company     : ${topJavaJob.row.company}`);
  console.log(`    intentScore : ${topJavaJob.searchIntentScore}`);
  console.log(`    matchScore  : ${topJavaJob.row.score}`);
  console.log(`    reasons     : ${topJavaJob.searchIntentReasons.join(' | ')}`);

  if (topNonJavaJob && topNonJavaJob !== topJob) {
    const nonJavaRank = scored.indexOf(topNonJavaJob) + 1;
    console.log(`\n  Top non-Java job (rank #${nonJavaRank}) ranked ABOVE best Java job:`);
    console.log(`    title       : "${topNonJavaJob.row.title}"`);
    console.log(`    intentScore : ${topNonJavaJob.searchIntentScore}  vs Java's ${topJavaJob.searchIntentScore}`);
    console.log(`    reasons     : ${topNonJavaJob.searchIntentReasons.join(' | ')}`);
  }

  if (topJavaJob.searchIntentScore < (topNonJavaJob?.searchIntentScore ?? 0)) {
    console.log(`\n  !! FINDING B: Java job EXISTS but scores lower than non-Java job.`);
    console.log(`     Java score=${topJavaJob.searchIntentScore}, non-Java score=${topNonJavaJob?.searchIntentScore}`);
  } else if (javaRank > 1) {
    console.log(`\n  !! FINDING B: Java job ranks #${javaRank} — investigate why #1 ranks above it.`);
  } else {
    console.log(`\n  ✓ Java job ranks #1 — ranking appears correct.`);
  }
} else {
  console.log(`\n  !! FINDING A confirmed: No job with "java" in its title exists in this scan.`);
  console.log(`     The ranking is not the problem — the scan did not fetch Java-titled jobs.`);
  if (javaByDesc.length > 0) {
    console.log(`     ${javaByDesc.length} job(s) mention "java" in their description but not in title.`);
    console.log(`     These will score lower because title-keyword signals are stronger.`);
  }
}

// ── SECTION 5: C/D — query path check ────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('SECTION 5 — Query path (C/D): does the keyword reach the scorer?');
console.log('══════════════════════════════════════════════════════════════════');

// Re-score one job with empty keywords to simulate missing filter
const testJob = allJobsInScan[0];
if (testJob) {
  const withKw    = computeSearchIntentScore(testJob, { keywords, location });
  const withoutKw = computeSearchIntentScore(testJob, { keywords: '', location });
  console.log(`\n  Test job: "${testJob.title}"`);
  console.log(`  Score WITH    keywords="${keywords}" location="${location}" : ${withKw.searchIntentScore}`);
  console.log(`  Score WITHOUT keywords (empty)                              : ${withoutKw.searchIntentScore}`);
  if (withKw.searchIntentScore === withoutKw.searchIntentScore) {
    console.log(`  !! FINDING C: keyword makes NO difference to score — query may not be reaching scorer.`);
  } else {
    console.log(`  ✓ keyword changes the score (+${withKw.searchIntentScore - withoutKw.searchIntentScore}) — query IS reaching scorer.`);
  }
}

// Check what scanRunId the filter signature would resolve to at list time
const resolvedAtListTime = resolveActiveScanRunId({ filters });
console.log(`\n  resolveActiveScanRunId({ filters }) at list time : ${resolvedAtListTime ?? 'null'}`);
if (!resolvedAtListTime) {
  console.log(`  !! FINDING D: the filter signature does not match any scan_run — listJobs will return empty.`);
  console.log(`     The UI likely sends scanRunId explicitly; if it does not, results will be empty.`);

  // Show all recent scan signatures
  const recent = db.prepare('SELECT id, status, search_filters, started_at FROM scan_runs ORDER BY started_at DESC LIMIT 5').all();
  console.log('\n  Recent scan_runs (last 5):');
  recent.forEach(r => console.log(`    ${r.id} | ${r.status} | ${r.started_at} | ${r.search_filters}`));
}

console.log('\n══════════════════════════════════════════════════════════════════');
console.log('DIAGNOSIS SUMMARY');
console.log('══════════════════════════════════════════════════════════════════');
const hasJavaTitle = javaByTitle.length > 0;
const hasJavaDesc  = javaByDesc.length > 0 && !hasJavaTitle;
const javaRankPos  = topJavaJob ? scored.indexOf(topJavaJob) + 1 : null;

if (!hasJavaTitle && !hasJavaDesc) {
  console.log('  ROOT CAUSE: A — No Java jobs fetched at all. Providers returned zero Java-titled jobs.');
  console.log('  FIX TARGET: ATS adapters / registry targets, not ranking logic.');
} else if (!hasJavaTitle && hasJavaDesc) {
  console.log('  ROOT CAUSE: A (partial) — Java jobs present in description only, not in title.');
  console.log('  Title-keyword signals dominate scoring; desc-only Java jobs score lower.');
  console.log('  FIX TARGET: Boost description-java signal OR investigate why job titles omit "Java".');
} else if (hasJavaTitle && javaRankPos && javaRankPos > 5) {
  console.log(`  ROOT CAUSE: B — Java jobs fetched (${javaByTitle.length} found) but ranked at position #${javaRankPos}.`);
  console.log('  FIX TARGET: Scoring weights — Java jobs should score higher than generic backend jobs.');
} else if (hasJavaTitle && javaRankPos && javaRankPos <= 5) {
  console.log(`  ✓ Java jobs are present AND rank in top 5 (position #${javaRankPos}).`);
  console.log('  If UI still shows wrong order, investigate D — response serialization / frontend sort.');
} else {
  console.log('  Inconclusive — check SECTION 3 output above.');
}
console.log('');
