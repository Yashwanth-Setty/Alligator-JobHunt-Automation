/**
 * Scan coverage diagnostic.
 * For a completed scan, reports what was actually fetched and whether
 * the right companies/keywords were covered.
 *
 * Usage:
 *   npm run debug:scan-coverage -- --keywords "Java Backend Developer" --location "United States"
 *   npm run debug:scan-coverage -- --scanRunId <uuid>
 *   npm run debug:scan-coverage -- --keywords "AI Engineer" --location "United States"
 */

import { getDb } from '../src/db/database.js';
import { planTargetsForSource, detectScanIntent } from '../src/services/companyRegistry/registryScanPlanner.js';
import { getMaxCompaniesPerSource } from '../src/sources/scanConfig.js';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const cliKeywords   = getArg('keywords') || '';
const cliLocation   = getArg('location') || '';
const cliScanRunId  = getArg('scanRunId') || null;

const db = getDb();

// ── Resolve scan run ──────────────────────────────────────────────────────────
let scan = null;

if (cliScanRunId) {
  scan = db.prepare('SELECT * FROM scan_runs WHERE id = ?').get(cliScanRunId);
  if (!scan) { console.error(`ERROR: scan run ${cliScanRunId} not found`); process.exit(1); }
} else if (cliKeywords) {
  // Find most recent completed scan matching these keywords
  const all = db.prepare(
    `SELECT * FROM scan_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 50`
  ).all();
  scan = all.find(s => {
    try {
      const f = JSON.parse(s.search_filters || '{}');
      const kwMatch = !cliKeywords || (f.keywords || '').toLowerCase().includes(cliKeywords.toLowerCase());
      const locMatch = !cliLocation || (f.location || '').toLowerCase().includes(cliLocation.toLowerCase().split(',')[0]);
      return kwMatch && locMatch;
    } catch { return false; }
  });
  if (!scan) {
    // fallback: most recent completed
    scan = db.prepare(`SELECT * FROM scan_runs WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`).get();
    if (scan) console.warn(`[warn] No scan matched "${cliKeywords}" / "${cliLocation}" — using latest completed scan`);
  }
}

if (!scan) {
  console.error('ERROR: No completed scan found. Run a scan first.');
  process.exit(1);
}

const scanFilters = (() => { try { return JSON.parse(scan.search_filters || '{}'); } catch { return {}; } })();
const keywords    = scanFilters.keywords || cliKeywords || '';
const location    = scanFilters.location || cliLocation || '';

// ── Fetch all jobs for this scan ──────────────────────────────────────────────
const jobs = db.prepare(
  `SELECT id, title, company, location, normalized_location, source, score, description, remote_type
   FROM jobs WHERE scan_run_id = ? AND COALESCE(is_hidden,0)=0`
).all(scan.id);

// ── Keyword matchers ──────────────────────────────────────────────────────────
const TERMS = [
  { label: 'java',              re: /\bjava\b/i },
  { label: 'spring',            re: /\bspring\b/i },
  { label: 'backend',           re: /\bbackend\b/i },
  { label: 'ai',                re: /\bai\b/i },
  { label: 'artificial intelligence', re: /artificial intelligence/i },
  { label: 'machine learning',  re: /machine learning/i },
  { label: 'ml',                re: /\bml\b/i },
  { label: 'llm',               re: /\bllm\b/i },
  { label: 'generative ai',     re: /generative ai/i },
  { label: 'react',             re: /\breact\b/i },
];

function matchTerm(re, job) {
  return re.test(job.title) || re.test(job.description || '');
}
function matchTitle(re, job) { return re.test(job.title); }
function matchDesc(re, job)  { return re.test(job.description || ''); }

// ── Planner reconstruction ────────────────────────────────────────────────────
const intent = detectScanIntent(keywords);
const maxPerSource = getMaxCompaniesPerSource();
const planResult   = planTargetsForSource('greenhouse', { filters: { keywords } });
const plannedTokens = planResult.targets.slice(0, maxPerSource).map(t => t.boardToken);

// ── Section helpers ───────────────────────────────────────────────────────────
function bar(n, total, width = 30) {
  const filled = total > 0 ? Math.round((n / total) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function section(title) {
  console.log(`\n${'═'.repeat(68)}`);
  console.log(title);
  console.log('═'.repeat(68));
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Scan metadata
// ─────────────────────────────────────────────────────────────────────────────
section('1 — SCAN METADATA');
console.log(`  scanRunId : ${scan.id}`);
console.log(`  keywords  : "${keywords}"`);
console.log(`  location  : "${location}"`);
console.log(`  status    : ${scan.status}`);
console.log(`  jobsFound : ${scan.jobs_found}`);
console.log(`  started   : ${scan.started_at}`);
console.log(`  finished  : ${scan.finished_at}`);
console.log(`  duration  : ${scan.started_at && scan.finished_at
  ? Math.round((new Date(scan.finished_at) - new Date(scan.started_at)) / 1000) + 's'
  : 'unknown'}`);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — Jobs by source
// ─────────────────────────────────────────────────────────────────────────────
section('2 — JOBS BY SOURCE');
const bySource = {};
for (const j of jobs) bySource[j.source] = (bySource[j.source] || 0) + 1;
const total = jobs.length;
for (const [src, cnt] of Object.entries(bySource).sort((a,b) => b[1]-a[1])) {
  console.log(`  ${src.padEnd(20)} ${String(cnt).padStart(4)}  ${bar(cnt, total)}`);
}
console.log(`  ${'TOTAL'.padEnd(20)} ${String(total).padStart(4)}`);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — Top 30 companies by job count
// ─────────────────────────────────────────────────────────────────────────────
section('3 — TOP 30 COMPANIES BY JOB COUNT');
const byCompany = {};
for (const j of jobs) {
  const key = `${j.company}|${j.source}`;
  if (!byCompany[key]) byCompany[key] = { company: j.company, source: j.source, count: 0 };
  byCompany[key].count++;
}
const topCompanies = Object.values(byCompany).sort((a,b) => b.count - a.count).slice(0, 30);
console.log(`  ${'#'.padEnd(3)} ${'company'.padEnd(32)} ${'source'.padEnd(16)} jobs`);
console.log('  ' + '─'.repeat(58));
topCompanies.forEach((c, i) =>
  console.log(`  ${String(i+1).padEnd(3)} ${c.company.slice(0,32).padEnd(32)} ${c.source.padEnd(16)} ${c.count}`)
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — Keyword coverage (title vs description)
// ─────────────────────────────────────────────────────────────────────────────
section('4 — KEYWORD COVERAGE IN FETCHED JOBS');
console.log(`  ${'keyword'.padEnd(22)} ${'title'.padStart(6)} ${'desc'.padStart(6)} ${'either'.padStart(7)}`);
console.log('  ' + '─'.repeat(45));
for (const { label, re } of TERMS) {
  const titleHits = jobs.filter(j => matchTitle(re, j)).length;
  const descHits  = jobs.filter(j => !matchTitle(re, j) && matchDesc(re, j)).length;
  const eitherHits = titleHits + descHits;
  const flag = eitherHits === 0 ? '  !! ZERO' : '';
  console.log(`  ${label.padEnd(22)} ${String(titleHits).padStart(6)} ${String(descHits).padStart(6)} ${String(eitherHits).padStart(7)}${flag}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — First 20 Java-related jobs
// ─────────────────────────────────────────────────────────────────────────────
section('5 — FIRST 20 JAVA-RELATED JOBS (title or description)');
const javaJobs = jobs.filter(j => /\bjava\b/i.test(j.title) || /\bjava\b/i.test(j.description || ''));
if (javaJobs.length === 0) {
  console.log('  !! NONE — zero jobs mention "java" in title or description');
} else {
  console.log(`  Total java-related: ${javaJobs.length}`);
  javaJobs.slice(0, 20).forEach((j, i) => {
    const inTitle = /\bjava\b/i.test(j.title) ? '[TITLE]' : '[DESC ]';
    console.log(`  [${String(i+1).padStart(2)}] ${inTitle} ${j.source.padEnd(16)} ${j.company.slice(0,25).padEnd(25)} "${j.title}"`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — First 20 AI-related jobs
// ─────────────────────────────────────────────────────────────────────────────
section('6 — FIRST 20 AI-RELATED JOBS (title or description)');
const aiRe = /\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bml\b|\bllm\b|\bgenerative ai\b/i;
const aiJobs = jobs.filter(j => aiRe.test(j.title) || aiRe.test(j.description || ''));
if (aiJobs.length === 0) {
  console.log('  !! NONE — zero jobs mention AI-related terms in title or description');
} else {
  // Sort: title hits first
  const aiSorted = [
    ...aiJobs.filter(j => aiRe.test(j.title)),
    ...aiJobs.filter(j => !aiRe.test(j.title)),
  ];
  console.log(`  Total AI-related: ${aiJobs.length} (${aiJobs.filter(j => aiRe.test(j.title)).length} in title)`);
  aiSorted.slice(0, 20).forEach((j, i) => {
    const inTitle = aiRe.test(j.title) ? '[TITLE]' : '[DESC ]';
    console.log(`  [${String(i+1).padStart(2)}] ${inTitle} ${j.source.padEnd(16)} ${j.company.slice(0,25).padEnd(25)} "${j.title}"`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Planner selection vs actual companies scanned
// ─────────────────────────────────────────────────────────────────────────────
section('7 — PLANNER SELECTION vs ACTUAL COMPANIES SCANNED');
console.log(`  intent.java    : ${intent.java}`);
console.log(`  intent.backend : ${intent.backend}`);
console.log(`  MAX_COMPANIES_PER_SOURCE (Greenhouse) : ${maxPerSource}`);
console.log(`\n  Greenhouse targets planner would select NOW (top ${maxPerSource}):`);
plannedTokens.forEach((tok, i) => console.log(`    ${String(i+1).padStart(2)}. ${tok}`));

const ghJobsInScan = jobs.filter(j => j.source === 'greenhouse');
const companiesInScan = [...new Set(ghJobsInScan.map(j => j.company.toLowerCase()))];
const tokensInScan    = [...new Set(ghJobsInScan.map(j => {
  // try to match company name to a board token
  return j.company.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}))];

console.log(`\n  Greenhouse companies actually in scan (${ghJobsInScan.length} jobs):`);
[...new Set(ghJobsInScan.map(j => j.company))].forEach(c => {
  const jobCount = ghJobsInScan.filter(j => j.company === c).length;
  console.log(`    - ${c.padEnd(30)} (${jobCount} jobs)`);
});

// Check overlap: were planned priority tokens actually scanned?
const JAVA_SET    = new Set(['elastic','okta','squarespace','datadog']);
const BACKEND_SET = new Set(['databricks','affirm','gitlab','palantir','brex','verkada','coinbase','okta']);
const prioritySet = intent.java ? JAVA_SET : intent.backend ? BACKEND_SET : new Set();

if (prioritySet.size > 0) {
  const priorityLabel = intent.java ? 'Java/JVM' : 'Backend';
  console.log(`\n  Priority companies for ${priorityLabel} intent:`);
  for (const tok of prioritySet) {
    const planned = plannedTokens.includes(tok);
    const inScan  = ghJobsInScan.some(j =>
      j.company.toLowerCase().replace(/[^a-z]/g,'').includes(tok.replace(/[^a-z]/g,''))
    );
    const icon = planned && inScan ? '✓' : planned && !inScan ? '? (planned but no jobs found)' : '✗ not in plan';
    console.log(`    ${tok.padEnd(20)} planned=${planned}  in_scan=${inScan}  ${icon}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Location analysis
// ─────────────────────────────────────────────────────────────────────────────
section('8 — LOCATION ANALYSIS');
const locBuckets = { exact: 0, us: 0, northAmerica: 0, international: 0, remote: 0, unknown: 0 };
for (const j of jobs) {
  const loc = `${j.location || ''} ${j.normalized_location || ''}`.toLowerCase();
  if (/remote/i.test(loc)) locBuckets.remote++;
  else if (location && new RegExp(location.split(',')[0], 'i').test(loc)) locBuckets.exact++;
  else if (/united states|u\.s\.|usa|\bca\b|\bny\b|\btx\b|\bfl\b|\bga\b|san francisco|new york|los angeles|chicago|dallas|austin/i.test(loc)) locBuckets.us++;
  else if (/canada|mexico|toronto|vancouver/i.test(loc)) locBuckets.northAmerica++;
  else if (/australia|uk|europe|india|germany|london|berlin|sydney|singapore/i.test(loc)) locBuckets.international++;
  else locBuckets.unknown++;
}
console.log(`  Query location: "${location}"`);
Object.entries(locBuckets).forEach(([k, v]) =>
  console.log(`  ${k.padEnd(16)} : ${String(v).padStart(4)}  ${bar(v, total, 25)}`)
);

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSIS
// ─────────────────────────────────────────────────────────────────────────────
section('DIAGNOSIS');

const javaTitle   = jobs.filter(j => /\bjava\b/i.test(j.title)).length;
const javaAny     = javaJobs.length;
const aiTitle     = jobs.filter(j => aiRe.test(j.title)).length;
const aiAny       = aiJobs.length;
const backendTitle = jobs.filter(j => /\bbackend\b/i.test(j.title)).length;

const isJavaSearch = /java|spring|jvm/i.test(keywords);
const isAiSearch   = /\bai\b|artificial intelligence|machine learning|\bml\b|\bllm\b|generative/i.test(keywords);

if (isJavaSearch) {
  if (javaTitle === 0 && javaAny === 0) {
    console.log('  B) SOURCE COVERAGE — zero Java jobs fetched (not in title or description).');
    console.log(`     ${total} jobs were fetched but none mention "java".`);
    console.log('     Registry targets scanned do not post Java roles.');
    console.log('     Fix: expand registry to include Java-heavy companies OR increase MAX_COMPANIES_PER_SOURCE.');
  } else if (javaTitle === 0 && javaAny > 0) {
    console.log(`  B) PARTIAL SOURCE COVERAGE — ${javaAny} jobs mention "java" in description but 0 in title.`);
    console.log('     Jobs require Java as a skill but use generic titles (e.g. "Software Engineer").');
    console.log('     Title-keyword scoring will not boost these — description signal is weaker.');
  } else {
    console.log(`  A) RANKING — ${javaTitle} Java-titled jobs were fetched.`);
    console.log('     Check if they rank in top 10 using debug:ranking-breakdown.');
  }
} else if (isAiSearch) {
  if (aiTitle === 0 && aiAny === 0) {
    console.log('  B) SOURCE COVERAGE — zero AI-related jobs fetched.');
    console.log(`     ${total} jobs were fetched but none mention AI/ML/LLM terms.`);
  } else if (aiTitle < 5) {
    console.log(`  B/A) WEAK COVERAGE — only ${aiTitle} AI-titled jobs and ${aiAny} total AI-mentioned jobs.`);
    console.log('     Most fetched jobs are generic engineering roles, not AI-specialist roles.');
    console.log('     Coverage is the primary bottleneck; ranking would also matter once coverage improves.');
  } else {
    console.log(`  A) RANKING — ${aiTitle} AI-titled jobs fetched (${aiAny} total mention AI).`);
    console.log('     Source coverage is adequate; check ranking quality.');
  }
} else {
  console.log('  Generic search — check coverage counts above for the relevant term.');
}

// C) Location check
if (locBuckets.international > 10 && locBuckets.exact < 5) {
  console.log('\n  C) LOCATION FALLBACK — significant international job bleed:');
  console.log(`     ${locBuckets.international} international jobs, only ${locBuckets.exact} in exact location.`);
  console.log('     Location scoring may be inflating irrelevant results from broad company boards.');
}

if (locBuckets.unknown > 20) {
  console.log(`\n  C) LOCATION UNKNOWN — ${locBuckets.unknown} jobs have no parseable location.`);
  console.log('     These may be remote-first or missing metadata; they score location signals weakly.');
}

console.log('');
