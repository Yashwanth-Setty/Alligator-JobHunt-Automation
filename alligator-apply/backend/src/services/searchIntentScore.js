/**
 * Search-intent ranking — separate from resume match score.
 * Used at list time to rank jobs without hard-filtering by keyword/location.
 */
import { expandLocationTerms, locationMatches } from './locationService.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'in', 'at', 'to', 'of', 'on',
]);

/** Titles that should rank lower for engineering role searches. */
export const UNRELATED_TITLE_PENALTIES = [
  { pattern: /product engineer/i, penalty: 35, label: 'product_engineer' },
  { pattern: /account executive/i, penalty: 40, label: 'account_executive' },
  { pattern: /customer engineer/i, penalty: 35, label: 'customer_engineer' },
  { pattern: /solutions architect/i, penalty: 28, label: 'solutions_architect' },
  { pattern: /\bdesigner\b/i, penalty: 25, label: 'designer' },
  { pattern: /sales engineer/i, penalty: 20, label: 'sales_engineer' },
  { pattern: /recruiter/i, penalty: 30, label: 'recruiter' },
];

/**
 * Title boosts applied only when the search has AI/ML/LLM intent.
 * Weights are set high enough to overcome a US state/city location advantage
 * for generic engineering roles (~54 pts for state+us+fuzzy match).
 */
export const AI_ROLE_TITLE_BOOSTS = [
  { pattern: /\bai\b/i,                    weight: 38, label: 'ai_role' },
  { pattern: /machine learning/i,           weight: 50, label: 'ml_role' },
  { pattern: /\bllm\b/i,                    weight: 50, label: 'llm_role' },
  { pattern: /generative ai/i,              weight: 55, label: 'generative_ai' },
  { pattern: /data scientist/i,             weight: 40, label: 'data_scientist' },
  { pattern: /research scientist/i,         weight: 70, label: 'research_scientist' },
  { pattern: /applied scientist/i,          weight: 70, label: 'applied_scientist' },
];

/** Titles/terms boosted for developer / full-stack searches.
 *  keywordSpecific: true → only apply when the boost term also appears in the search query.
 *  Without this flag, the boost fires for any developer-role search (generic signal). */
export const ROLE_TITLE_BOOSTS = [
  { pattern: /\bjava\b/i, weight: 28, label: 'java', keywordSpecific: true },
  { pattern: /full[\s-]?stack/i, weight: 26, label: 'full_stack', keywordSpecific: true },
  { pattern: /\bbackend\b/i, weight: 22, label: 'backend', keywordSpecific: true },
  { pattern: /\bfrontend\b/i, weight: 18, label: 'frontend', keywordSpecific: true },
  { pattern: /software engineer/i, weight: 24, label: 'software_engineer' },
  { pattern: /application developer/i, weight: 24, label: 'application_developer' },
  { pattern: /\bspring\b/i, weight: 18, label: 'spring', keywordSpecific: true },
  { pattern: /\breact\b/i, weight: 14, label: 'react', keywordSpecific: true },
  { pattern: /\bpython\b/i, weight: 14, label: 'python', keywordSpecific: true },
  { pattern: /\bnode\b/i, weight: 12, label: 'node', keywordSpecific: true },
  { pattern: /\bdeveloper\b/i, weight: 16, label: 'developer' },
  { pattern: /\bengineer\b/i, weight: 12, label: 'engineer' },
];

const STATE_ABBR_TO_NAME = {
  fl: 'florida', ga: 'georgia', ca: 'california', tx: 'texas', ny: 'new york',
  wa: 'washington', il: 'illinois', ma: 'massachusetts', nc: 'north carolina',
  nj: 'new jersey', pa: 'pennsylvania', va: 'virginia', co: 'colorado',
};

const US_STATE_NAMES = new Set(Object.values(STATE_ABBR_TO_NAME));

function parseLocationQuery(query = '') {
  const raw = String(query || '').trim();
  if (!raw) return { city: '', stateAbbr: '', stateName: '', terms: [] };
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const city = (parts[0] || '').toLowerCase();
  const statePart = (parts[1] || '').toLowerCase();
  const stateAbbr = statePart.length === 2 ? statePart : '';
  const stateName = stateAbbr
    ? STATE_ABBR_TO_NAME[stateAbbr] || statePart
    : US_STATE_NAMES.has(statePart)
      ? statePart
      : statePart.length > 2
        ? statePart
        : '';
  const { terms } = expandLocationTerms(raw);
  return { city, stateAbbr, stateName, terms, raw: raw.toLowerCase() };
}

function splitKeywordTerms(keywords = '') {
  const raw = String(keywords || '').trim();
  if (!raw) return [];
  const terms = new Set();
  terms.add(raw.toLowerCase());
  raw
    .split(/[,/|]+/)
    .flatMap((chunk) => chunk.split(/\s+/))
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    .forEach((t) => terms.add(t));
  if (/\bjava\b/i.test(raw)) {
    ['java', 'jvm', 'spring', 'backend'].forEach((t) => terms.add(t));
  }
  if (/full[\s-]?stack/i.test(raw)) {
    ['full stack', 'fullstack', 'frontend', 'backend'].forEach((t) => terms.add(t));
  }
  if (/\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bml\b|\bllm\b|\bgenerative ai\b/i.test(raw)) {
    ['ai', 'machine learning', 'ml', 'llm', 'research scientist', 'applied scientist', 'generative ai', 'deep learning'].forEach((t) => terms.add(t));
  }
  return [...terms];
}

function isDeveloperRoleSearch(keywords = '') {
  const k = String(keywords || '').toLowerCase();
  return (
    /\b(java|developer|engineer|full[\s-]?stack|backend|frontend|software)\b/.test(k)
  );
}

function isAiRoleSearch(keywords = '') {
  return /\bai\b|\bartificial intelligence\b|\bmachine learning\b|\bml\b|\bllm\b|\bgenerative ai\b/i.test(
    String(keywords || '')
  );
}

/**
 * Score how well a job location matches the search location query.
 */
export function scoreLocationIntent(jobLocation = '', normalizedLocation = '', locationQuery = '') {
  const reasons = [];
  let points = 0;
  if (!locationQuery) return { points: 0, reasons, tier: 'none' };

  const haystack = `${jobLocation} ${normalizedLocation}`.toLowerCase();
  const parsed = parseLocationQuery(locationQuery);
  const isCitySearch = Boolean(parsed.city && parsed.city.length >= 3 && !US_STATE_NAMES.has(parsed.city));

  if (isCitySearch && parsed.city && haystack.includes(parsed.city)) {
    points += 45;
    reasons.push('location_city_exact');
  }

  if (parsed.stateAbbr && new RegExp(`\\b${parsed.stateAbbr}\\b`).test(haystack)) {
    points += 30;
    reasons.push('location_state');
  } else if (parsed.stateName && haystack.includes(parsed.stateName)) {
    points += 28;
    reasons.push('location_state');
  }

  if (/remote.*(us|u\.s\.|usa|united states)/i.test(haystack) || /remote,\s*us/i.test(haystack)) {
    points += 22;
    reasons.push('location_remote_us');
  } else if (
    /\bremote\b/i.test(haystack)
    && (haystack.includes('united states') || haystack.includes('usa') || haystack.includes(' us'))
  ) {
    points += 20;
    reasons.push('location_remote_us');
  }

  if (haystack.includes('united states') || /\busa\b/.test(haystack) || /\bremote us\b/.test(haystack)) {
    points += 16;
    reasons.push('location_united_states');
  }

  if (haystack.includes('north america')) {
    points += 10;
    reasons.push('location_north_america');
  }

  if (/\bsan francisco\b|\bsf\b/.test(haystack) && isCitySearch && parsed.city && !haystack.includes(parsed.city)) {
    points += 4;
    reasons.push('location_sf');
  }

  if (/\beurope\b|\bemea\b|\bberlin\b|\bparis\b|\blondon\b/.test(haystack) && isCitySearch) {
    points += 3;
    reasons.push('location_europe');
  }

  if (locationMatches(jobLocation, normalizedLocation || '', locationQuery)) {
    points += 8;
    reasons.push('location_fuzzy_match');
  }

  let tier = 'none';
  if (reasons.includes('location_city_exact')) tier = 'city';
  else if (reasons.includes('location_state')) tier = 'state';
  else if (reasons.includes('location_remote_us') || reasons.includes('location_united_states')) tier = 'country';
  else if (points > 0) tier = 'region';

  return { points, reasons, tier };
}

/**
 * @param {object} job — row or normalized job with title, location, description, remote_type
 * @param {object} filters — keywords, location, remoteType
 */
export function computeSearchIntentScore(job, filters = {}) {
  const reasons = [];
  let score = 0;

  const title = String(job.title || '').toLowerCase();
  const description = String(job.description || '').toLowerCase();
  const text = `${title} ${description}`;
  const keywords = String(filters.keywords || '').trim();
  const locationQuery = String(filters.location || '').trim();
  const remoteType = filters.remoteType;

  if (keywords) {
    const kwLower = keywords.toLowerCase();
    const terms = splitKeywordTerms(keywords);
    const developerSearch = isDeveloperRoleSearch(keywords);

    if (title.includes(kwLower)) {
      score += 35;
      reasons.push('title_full_phrase');
    } else if (terms.filter((t) => t.length > 2).every((t) => title.includes(t))) {
      score += 28;
      reasons.push('title_all_terms');
    } else {
      let termHits = 0;
      for (const term of terms) {
        if (term.length < 3) continue;
        if (title.includes(term)) {
          termHits += 1;
          score += 8;
          reasons.push(`title_term:${term}`);
        } else if (text.includes(term)) {
          score += 3;
          reasons.push(`desc_term:${term}`);
        }
      }
      if (termHits >= 2) {
        score += 10;
        reasons.push('title_multi_term');
      }
    }

    if (developerSearch) {
      for (const boost of ROLE_TITLE_BOOSTS) {
        if (!boost.pattern.test(title)) continue;
        if (boost.keywordSpecific) {
          // Only apply technology-specific boosts when that term appears in the search keywords.
          const relevantToSearch = terms.some((t) => boost.pattern.test(t));
          if (!relevantToSearch) continue;
        }
        score += boost.weight;
        reasons.push(`boost:${boost.label}`);
      }
      for (const penalty of UNRELATED_TITLE_PENALTIES) {
        if (penalty.pattern.test(title)) {
          score -= penalty.penalty;
          reasons.push(`penalty:${penalty.label}`);
        }
      }
    }

    if (isAiRoleSearch(keywords)) {
      for (const boost of AI_ROLE_TITLE_BOOSTS) {
        if (boost.pattern.test(title)) {
          score += boost.weight;
          reasons.push(`boost:${boost.label}`);
        }
      }
    }
  }

  if (locationQuery) {
    const loc = scoreLocationIntent(job.location, job.normalized_location, locationQuery);
    score += loc.points;
    reasons.push(...loc.reasons);
  }

  if (remoteType === 'remote' && String(job.remote_type || '').toLowerCase() === 'remote') {
    score += 12;
    reasons.push('remote_preference');
  }

  // [DIAG-4] per-job intent score
  console.log('[DIAG-4]', JSON.stringify({ title: job.title, searchIntentScore: Math.max(0, score), searchIntentReasons: reasons }));
  return {
    searchIntentScore: Math.max(0, score),
    searchIntentReasons: reasons,
  };
}

/** Whether any job in the set has a strong location match for the query. */
export function hasStrongLocationMatch(jobs, locationQuery) {
  if (!locationQuery) return true;
  return jobs.some((job) => {
    const { searchIntentReasons } = computeSearchIntentScore(job, { location: locationQuery });
    return (
      searchIntentReasons.includes('location_city_exact')
      || searchIntentReasons.includes('location_state')
    );
  });
}

/**
 * Sort jobs by search intent then resume match score.
 */
export function sortJobsBySearchIntent(scoredRows, sortBy = 'score', sortOrder = 'desc') {
  const dir = sortOrder === 'asc' ? 1 : -1;
  return [...scoredRows].sort((a, b) => {
    if (b.searchIntentScore !== a.searchIntentScore) {
      return b.searchIntentScore - a.searchIntentScore;
    }
    const scoreA = Number(a.row?.score ?? a.score ?? 0);
    const scoreB = Number(b.row?.score ?? b.score ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;

    if (sortBy === 'date_posted') {
      const da = a.row?.date_posted || '';
      const db = b.row?.date_posted || '';
      if (!da && db) return 1;
      if (da && !db) return -1;
      return da < db ? dir : da > db ? -dir : 0;
    }
    if (sortBy === 'salary') {
      const sa = Number(a.row?.salary_max ?? a.row?.salary_min ?? 0);
      const sb = Number(b.row?.salary_max ?? b.row?.salary_min ?? 0);
      return sa < sb ? dir : sa > sb ? -dir : 0;
    }
    if (sortBy === 'company') {
      const ca = String(a.row?.company || '').toLowerCase();
      const cb = String(b.row?.company || '').toLowerCase();
      return ca < cb ? dir : ca > cb ? -dir : 0;
    }
    if (sortBy === 'location') {
      const la = String(a.row?.location || '').toLowerCase();
      const lb = String(b.row?.location || '').toLowerCase();
      return la < lb ? dir : la > lb ? -dir : 0;
    }
    return 0;
  });
}

export function scoreAndSortJobRows(rows, filters, sortBy = 'score', sortOrder = 'desc') {
  const scored = rows.map((row) => {
    const intent = computeSearchIntentScore(row, filters);
    return { row, ...intent };
  });
  return sortJobsBySearchIntent(scored, sortBy, sortOrder);
}
