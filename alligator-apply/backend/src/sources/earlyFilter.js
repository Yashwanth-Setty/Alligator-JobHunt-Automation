import {
  locationMatches,
  normalizeLocation,
  isBroadCountryLocation,
  expandLocationTerms,
  resolveCanonicalLocation,
} from '../services/locationService.js';

function buildFetchFilters(filters = {}) {
  const { minScore, tab, page, limit, sortBy, sortOrder, ...rest } = filters;
  return rest;
}

function splitKeywordPhrases(keywords = '') {
  return String(keywords || '')
    .split(/[,;\n|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Role-related tokens used for term expansion. */
const ROLE_TERM_SIGNALS = [
  'full stack',
  'fullstack',
  'full-stack',
  'software engineer',
  'software developer',
  'backend engineer',
  'backend developer',
  'frontend engineer',
  'frontend developer',
  'developer',
  'engineer',
  'programmer',
  'architect',
  'devops',
  'sre',
  'java',
  'python',
  'javascript',
  'typescript',
  'react',
  'node',
  'kubernetes',
];

/** Queries that should pass through early fetch — scoring decides relevance. */
const BROAD_PASS_THROUGH_SIGNALS = [
  'full stack',
  'fullstack',
  'full-stack',
  'software engineer',
  'software developer',
  'backend engineer',
  'backend developer',
  'frontend engineer',
  'frontend developer',
  'developer',
  'engineer',
  'programmer',
];

const ROLE_SYNONYM_GROUPS = [
  ['full stack', 'fullstack', 'full-stack'],
  ['software engineer', 'software developer', 'swe'],
  ['backend engineer', 'backend developer', 'back-end engineer', 'back end engineer'],
  ['frontend engineer', 'frontend developer', 'front-end engineer', 'front end engineer'],
  ['java', 'java developer', 'java engineer'],
  ['developer', 'dev'],
  ['engineer', 'engineering'],
];

const EARLY_FILTER_STOPWORDS = new Set([
  'the',
  'and',
  'or',
  'for',
  'with',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
]);

/**
 * Broad role/tech queries should not eliminate jobs before scoring.
 * @param {string} keywords
 */
export function isBroadKeywordQuery(keywords = '') {
  const raw = String(keywords || '').trim().toLowerCase();
  if (!raw) return false;
  return BROAD_PASS_THROUGH_SIGNALS.some((signal) => raw.includes(signal));
}

/**
 * Expand keyword query into permissive early-fetch terms (not full phrase).
 * @param {string} keywords
 * @returns {string[]}
 */
export function expandEarlyFilterTerms(keywords = '') {
  const raw = String(keywords || '').trim().toLowerCase();
  if (!raw) return [];

  const terms = new Set();
  const phrases = splitKeywordPhrases(keywords);
  const inputs = phrases.length ? phrases : [raw];

  for (const phrase of inputs) {
    const p = phrase.toLowerCase().trim();
    if (!p) continue;
    terms.add(p);

    const words = p.split(/\s+/).filter(Boolean);
    for (const word of words) {
      const clean = word.replace(/[^a-z0-9+#.]/gi, '');
      if (clean && !EARLY_FILTER_STOPWORDS.has(clean)) terms.add(clean);
    }
    for (let i = 0; i < words.length - 1; i += 1) {
      terms.add(`${words[i]} ${words[i + 1]}`.toLowerCase());
    }
  }

  for (const group of ROLE_SYNONYM_GROUPS) {
    if (group.some((g) => raw.includes(g))) {
      for (const synonym of group) terms.add(synonym);
    }
  }

  for (const signal of ROLE_TERM_SIGNALS) {
    if (raw.includes(signal)) terms.add(signal);
  }

  return [...terms].filter((t) => t.length >= 2 && !EARLY_FILTER_STOPWORDS.has(t));
}

function isMeaningfulTerm(term) {
  if (!term || term.length < 2) return false;
  if (term.length >= 3) return true;
  return new Set(['ui', 'ux', 'ai', 'ml', 'go', 'qa', 'hr', 'it', 'pm']).has(term);
}

/**
 * Permissive keyword gate for fetch/early stages.
 * @param {string} haystack
 * @param {string} keywords
 */
export function matchesPermissiveKeywordFilter(haystack = '', keywords = '') {
  const raw = String(keywords || '').trim();
  if (!raw) return true;
  if (isBroadKeywordQuery(raw)) return true;

  const text = String(haystack || '').toLowerCase();
  const terms = expandEarlyFilterTerms(raw);
  if (terms.length === 0) return true;

  return terms.filter(isMeaningfulTerm).some((term) => text.includes(term.toLowerCase()));
}

function isSpecificCityLocation(filterLocation = '') {
  const raw = String(filterLocation || '').trim().toLowerCase();
  if (!raw || isBroadCountryLocation(filterLocation)) return false;
  if (raw.includes(',')) return true;
  const { terms } = expandLocationTerms(filterLocation);
  return terms.some((t) => t.length >= 4 && !isBroadCountryLocation(t));
}

function isRemoteLocationText(location = '') {
  const loc = String(location || '').toLowerCase();
  return !loc || /\bremote\b|work from anywhere|wfh|distributed/.test(loc);
}

/**
 * Only reject when a specific city filter clearly conflicts with raw location metadata.
 * @param {string} jobLocation
 * @param {string} filterLocation
 */
export function hasClearLocationConflict(jobLocation = '', filterLocation = '') {
  const job = String(jobLocation || '').trim();
  const filter = String(filterLocation || '').trim();
  if (!filter || !job) return false;
  if (isRemoteLocationText(job)) return false;
  if (locationMatches(job, normalizeLocation(job), filter)) return false;

  const jobCanon = resolveCanonicalLocation(job);
  const filterCanon = resolveCanonicalLocation(filter);
  if (jobCanon && filterCanon && jobCanon !== filterCanon) {
    return true;
  }

  const intlMarkers = [
    'united kingdom',
    ' uk',
    'uk,',
    'india',
    'germany',
    'france',
    'canada',
    'europe',
    'emea',
    'apac',
    'latam',
    'australia',
    'singapore',
    'japan',
    'china',
  ];
  const filterIsUS =
    isBroadCountryLocation(filter) || filterCanon === 'United States' || filter.toLowerCase().includes('united states');
  if (filterIsUS && intlMarkers.some((m) => job.toLowerCase().includes(m))) {
    return true;
  }

  return false;
}

/**
 * Permissive location gate for fetch/early stages.
 * @param {string} jobLocation
 * @param {string} [normalizedJobLocation]
 * @param {string} filterLocation
 */
export function passesPermissiveLocationFilter(
  jobLocation = '',
  normalizedJobLocation = '',
  filterLocation = ''
) {
  const filter = String(filterLocation || '').trim();
  if (!filter) return true;
  if (isBroadCountryLocation(filter)) return true;
  if (isRemoteLocationText(jobLocation)) return true;
  if (locationMatches(jobLocation, normalizedJobLocation || normalizeLocation(jobLocation), filter)) {
    return true;
  }
  if (!isSpecificCityLocation(filter)) return true;
  return !hasClearLocationConflict(jobLocation, filter);
}

function buildEarlyFilterSearchText(raw, source, title, company, location) {
  const description = extractDescription(raw, source);
  return `${title} ${company} ${location} ${description}`.toLowerCase();
}

/**
 * Lightweight pre-normalization filters using raw API metadata only.
 * Permissive — scoring and post-normalization filters decide relevance.
 * @param {object} raw - raw job from API
 * @param {import('./types.js').SearchFilters} filters
 * @param {string} source
 */
export function passesEarlyFilter(raw, filters, source = '') {
  const safeFilters = buildFetchFilters(filters);
  if (!safeFilters || Object.keys(safeFilters).length === 0) return true;

  const title = extractTitle(raw, source).toLowerCase();
  const company = extractCompany(raw, source).toLowerCase();
  const location = extractLocation(raw, source);
  const locationLower = location.toLowerCase();

  if (safeFilters.keywords) {
    const text = buildEarlyFilterSearchText(raw, source, title, company, locationLower);
    if (!matchesPermissiveKeywordFilter(text, safeFilters.keywords)) return false;
  }

  if (safeFilters.location && !safeFilters._aiLocationBypass) {
    if (
      !passesPermissiveLocationFilter(location, normalizeLocation(location), safeFilters.location)
    ) {
      return false;
    }
  }

  if (safeFilters.company) {
    const co = safeFilters.company.toLowerCase();
    if (!company.includes(co)) return false;
  }

  if (safeFilters.remoteType) {
    const wm = inferWorkModeFromRaw(raw, source, locationLower);
    if (wm && wm !== safeFilters.remoteType) return false;
  }

  if (safeFilters.employmentType) {
    const et = extractEmployment(raw, source);
    if (et && et !== safeFilters.employmentType) return false;
  }

  return true;
}

function extractTitle(raw, source) {
  if (source === 'smartrecruiters') return raw.name || raw.title || '';
  if (source === 'lever') return raw.text || raw.title || '';
  return raw.title || '';
}

function extractCompany(raw, source) {
  return raw.company_name || raw.company?.name || raw.companyName || raw._boardToken || '';
}

function extractLocation(raw, source) {
  if (source === 'lever') return raw.categories?.location || raw.location || '';
  if (source === 'smartrecruiters') return raw.location?.fullLocation || raw.location?.city || '';
  if (source === 'ashby') return raw.locationName || raw.location || '';
  if (typeof raw.location === 'string') return raw.location;
  return raw.location?.name || raw.location || '';
}

function extractDescription(raw, source) {
  if (source === 'lever') return raw.descriptionPlain || raw.description || '';
  if (source === 'ashby') return raw.descriptionPlain || raw.description || '';
  if (source === 'smartrecruiters') return raw.jobAd?.sections?.jobDescription?.text || '';
  return raw.content || raw.description || '';
}

function extractEmployment(raw, source) {
  const v = raw.employment_type || raw.employmentType || raw.categories?.commitment || '';
  const s = String(v).toLowerCase();
  if (s.includes('intern')) return 'internship';
  if (s.includes('contract')) return 'contract';
  if (s.includes('part')) return 'part_time';
  return s ? 'full_time' : '';
}

function inferWorkModeFromRaw(raw, source, locationStr) {
  const loc = locationStr || extractLocation(raw, source);
  const lower = loc.toLowerCase();
  if (raw.location?.remote || lower.includes('remote')) return 'remote';
  if (raw.location?.hybrid || lower.includes('hybrid')) return 'hybrid';
  if (lower.includes('onsite') || lower.includes('on-site')) return 'onsite';
  return '';
}
