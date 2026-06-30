/**
 * Source keyword coverage diagnostic.
 * Fetches raw jobs from registry targets WITHOUT persisting and reports
 * how many contain a given keyword in title vs description.
 *
 * Usage:
 *   npm run debug:source-keyword-coverage -- --keyword "java"
 *   npm run debug:source-keyword-coverage -- --keyword "java" --limitTargets 50
 *   npm run debug:source-keyword-coverage -- --keyword "java" --sources greenhouse,lever
 *
 * No data is written to the database.
 */

import { fetchJson } from '../src/sources/httpClient.js';
import { planTargetsForSource } from '../src/services/companyRegistry/registryScanPlanner.js';
import { getDb } from '../src/db/database.js';

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

const keyword      = (getArg('keyword') || 'java').toLowerCase();
const limitTargets = parseInt(getArg('limitTargets') || '100', 10);
const sourcesArg   = getArg('sources');
const TIMEOUT_MS   = parseInt(getArg('timeout') || '12000', 10);

// Supported live sources (adapters that expose simple HTTP fetch)
const ALL_SOURCES = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'];
const SOURCES = sourcesArg
  ? sourcesArg.split(',').map(s => s.trim().toLowerCase()).filter(s => ALL_SOURCES.includes(s))
  : ALL_SOURCES;

// ── per-source fetchers (raw HTTP, no adapter pipeline) ───────────────────────
async function fetchRaw(source, target) {
  const token = target.boardToken;
  try {
    switch (source) {
      case 'greenhouse': {
        const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`;
        const data = await fetchJson(url, { timeoutMs: TIMEOUT_MS });
        return (data?.jobs || []).map(j => ({ title: j.title || '', description: j.content || '', url: j.absolute_url || '', _src: url }));
      }
      case 'lever': {
        const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
        const data = await fetchJson(url, { timeoutMs: TIMEOUT_MS });
        return (Array.isArray(data) ? data : []).map(j => ({
          title: j.text || '',
          description: [j.descriptionPlain, j.additionalPlain].filter(Boolean).join(' '),
          url: j.hostedUrl || '',
          _src: url,
        }));
      }
      case 'ashby': {
        const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`;
        const data = await fetchJson(url, { timeoutMs: TIMEOUT_MS });
        return (data?.jobPostings || []).map(j => ({
          title: j.title || '',
          description: j.descriptionHtml || j.description || '',
          url: j.jobUrl || '',
          _src: url,
        }));
      }
      case 'smartrecruiters': {
        const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings?limit=100`;
        const data = await fetchJson(url, { timeoutMs: TIMEOUT_MS });
        return (data?.content || []).map(j => ({
          title: j.name || '',
          description: j.jobAd?.sections?.jobDescription?.text || '',
          url: j.ref || '',
          _src: url,
        }));
      }
      default:
        return [];
    }
  } catch (err) {
    return { error: err.message };
  }
}

function containsKeyword(text = '') {
  return new RegExp(`\\b${keyword}\\b`, 'i').test(text);
}

// ── main ──────────────────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════');
console.log(`Source keyword coverage: keyword="${keyword}"  limitTargets=${limitTargets}`);
console.log(`Sources: ${SOURCES.join(', ')}`);
console.log('══════════════════════════════════════════════════════════════════\n');

// Make sure DB is initialised (needed for registry reads)
getDb();

const globalSummary = [];

for (const source of SOURCES) {
  const { origin, targets } = planTargetsForSource(source, { limit: limitTargets });
  const limited = targets.slice(0, limitTargets);

  console.log(`\n──────────────────────────────────────────────────────────────────`);
  console.log(`SOURCE: ${source.toUpperCase()}   origin=${origin}   targets=${limited.length}`);
  console.log(`──────────────────────────────────────────────────────────────────`);

  if (limited.length === 0) {
    console.log('  (no targets configured — skipping)');
    continue;
  }

  let totalRaw       = 0;
  let totalTitleHits = 0;
  let totalDescHits  = 0;
  let errors         = 0;
  const companyHits  = [];   // { company, token, titleHits, descHits, titles[] }
  const kwTitles     = [];   // all job titles matching keyword in title

  for (const target of limited) {
    const token   = target.boardToken || target.companyName;
    const company = target.companyName || token;
    const careersUrl = target.careersUrl || `(source=${source} token=${token})`;

    process.stdout.write(`  Fetching ${company} (${token}) … `);

    const raw = await fetchRaw(source, target);

    if (!Array.isArray(raw)) {
      console.log(`ERROR: ${raw.error}`);
      errors += 1;
      continue;
    }

    totalRaw += raw.length;
    const byTitle = raw.filter(j => containsKeyword(j.title));
    const byDesc  = raw.filter(j => !containsKeyword(j.title) && containsKeyword(j.description));
    totalTitleHits += byTitle.length;
    totalDescHits  += byDesc.length;

    kwTitles.push(...byTitle.map(j => ({ company, title: j.title, url: j.url, token, careersUrl })));

    if (byTitle.length > 0 || byDesc.length > 0) {
      companyHits.push({ company, token, careersUrl, totalJobs: raw.length, titleHits: byTitle.length, descHits: byDesc.length });
    }

    console.log(`${raw.length} jobs  title-hits=${byTitle.length}  desc-hits=${byDesc.length}`);
  }

  // ── per-source report ─────────────────────────────────────────────────────
  console.log(`\n  ── ${source} SUMMARY ──`);
  console.log(`  targets fetched  : ${limited.length - errors} ok, ${errors} errors`);
  console.log(`  total raw jobs   : ${totalRaw}`);
  console.log(`  "${keyword}" in TITLE : ${totalTitleHits}`);
  console.log(`  "${keyword}" in DESC  : ${totalDescHits}`);

  if (companyHits.length > 0) {
    console.log(`\n  Companies with "${keyword}" jobs:`);
    companyHits
      .sort((a, b) => b.titleHits - a.titleHits)
      .forEach(c =>
        console.log(`    ${c.company.padEnd(35)} token=${c.token.padEnd(30)} title=${c.titleHits}  desc=${c.descHits}  total=${c.totalJobs}`)
      );
  } else {
    console.log(`\n  No companies returned "${keyword}" jobs.`);
  }

  if (kwTitles.length > 0) {
    console.log(`\n  First 20 "${keyword}" job titles (in title):`);
    kwTitles.slice(0, 20).forEach((j, i) =>
      console.log(`    [${String(i+1).padStart(2)}] ${j.company.padEnd(30)} "${j.title}"`)
    );
  }

  globalSummary.push({ source, totalTargets: limited.length, errors, totalRaw, totalTitleHits, totalDescHits, companyHits, kwTitles });
}

// ── global summary ─────────────────────────────────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════════════════');
console.log(`GLOBAL SUMMARY — keyword="${keyword}"`);
console.log('══════════════════════════════════════════════════════════════════');
console.log(`${'source'.padEnd(18)} ${'targets'.padStart(7)} ${'rawJobs'.padStart(8)} ${'titleHits'.padStart(10)} ${'descHits'.padStart(9)}`);
console.log('─'.repeat(60));
let gRaw = 0, gTitle = 0, gDesc = 0;
for (const s of globalSummary) {
  gRaw   += s.totalRaw;
  gTitle += s.totalTitleHits;
  gDesc  += s.totalDescHits;
  console.log(
    `${s.source.padEnd(18)} ${String(s.totalTargets).padStart(7)} ${String(s.totalRaw).padStart(8)} ${String(s.totalTitleHits).padStart(10)} ${String(s.totalDescHits).padStart(9)}`
  );
}
console.log('─'.repeat(60));
console.log(`${'TOTAL'.padEnd(18)} ${''.padStart(7)} ${String(gRaw).padStart(8)} ${String(gTitle).padStart(10)} ${String(gDesc).padStart(9)}`);

// All companies that have title hits, across all sources, sorted by count
const allCompanyHits = globalSummary.flatMap(s => s.companyHits.map(c => ({ ...c, source: s.source })));
allCompanyHits.sort((a, b) => b.titleHits - a.titleHits);

if (allCompanyHits.length > 0) {
  console.log(`\nTop companies with "${keyword}" in job TITLES (any source):`);
  allCompanyHits.slice(0, 30).forEach((c, i) =>
    console.log(`  [${String(i+1).padStart(2)}] ${c.source.padEnd(16)} ${c.company.padEnd(35)} token=${c.token}  titleHits=${c.titleHits}`)
  );
} else {
  console.log(`\n!! No companies across any source returned a job with "${keyword}" in the title.`);
}

// Final diagnosis
console.log('\n══════════════════════════════════════════════════════════════════');
console.log('DIAGNOSIS');
console.log('══════════════════════════════════════════════════════════════════');
if (gTitle === 0 && gDesc === 0) {
  console.log(`  A: Keyword "${keyword}" not found in title OR description across ${gRaw} jobs from ${globalSummary.reduce((n,s)=>n+s.totalTargets,0)} targets.`);
  console.log(`     Either the registry targets do not employ "${keyword}" engineers,`);
  console.log(`     or the companies do not currently have open "${keyword}" positions.`);
} else if (gTitle === 0 && gDesc > 0) {
  console.log(`  PARTIAL: "${keyword}" found in ${gDesc} job descriptions but 0 titles.`);
  console.log(`     Jobs mention "${keyword}" as a skill/requirement but use generic titles.`);
  console.log(`     These jobs WILL appear in scans; title-keyword scoring won't boost them.`);
} else {
  console.log(`  "${keyword}" found in ${gTitle} job titles across ${allCompanyHits.length} companies.`);
  console.log(`  These companies should be prioritized in the registry for "${keyword}" searches.`);
}
console.log('');
