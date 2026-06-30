/**
 * Location normalization, fuzzy matching, and hierarchical search.
 */

const REGIONS = {
  'United States': {
    aliases: [
      'us',
      'usa',
      'u.s.',
      'u.s.a.',
      'united states of america',
      'america',
      'remote us',
      'remote - us',
      'remote - united states',
      'remote united states',
      'remote - u.s.',
      'remote - usa',
      'us remote',
      'usa remote',
    ],
    states: [
      'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
      'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
      'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
      'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
      'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina',
      'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island',
      'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont',
      'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
    ],
    stateAbbrs: [
      'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in',
      'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv',
      'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn',
      'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'dc',
    ],
    cities: [
      'new york', 'los angeles', 'chicago', 'houston', 'phoenix', 'philadelphia',
      'san antonio', 'san diego', 'dallas', 'austin', 'seattle', 'denver', 'boston',
      'atlanta', 'miami', 'san francisco', 'portland', 'san jose', 'tampa', 'orlando',
    ],
  },
  Canada: {
    aliases: ['ca', 'can', 'remote canada', 'remote - canada', 'canada remote'],
    states: ['ontario', 'quebec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan'],
    stateAbbrs: ['on', 'qc', 'bc', 'ab', 'mb', 'sk'],
    cities: ['toronto', 'vancouver', 'montreal', 'calgary', 'ottawa'],
  },
  India: {
    aliases: ['in', 'remote india', 'remote - india', 'india remote'],
    states: ['karnataka', 'maharashtra', 'telangana', 'tamil nadu', 'delhi'],
    stateAbbrs: [],
    cities: ['bangalore', 'bengaluru', 'mumbai', 'hyderabad', 'pune', 'chennai', 'delhi'],
  },
  'United Kingdom': {
    aliases: ['uk', 'u.k.', 'britain', 'great britain', 'england', 'remote uk', 'remote - uk'],
    states: ['scotland', 'wales', 'northern ireland', 'england'],
    stateAbbrs: [],
    cities: ['london', 'manchester', 'birmingham', 'edinburgh'],
  },
  Europe: {
    aliases: ['eu', 'europe remote', 'remote europe', 'remote - europe', 'emea'],
    states: [],
    stateAbbrs: [],
    cities: ['berlin', 'paris', 'amsterdam', 'dublin', 'madrid'],
  },
  'Remote Global': {
    aliases: [
      'remote',
      'worldwide',
      'global',
      'anywhere',
      'work from anywhere',
      'remote - global',
      'remote global',
    ],
    states: [],
    stateAbbrs: [],
    cities: [],
  },
};

export const PRESET_LOCATION_SUGGESTIONS = [
  { label: 'United States', value: 'United States', type: 'country' },
  { label: 'Remote - United States', value: 'United States', type: 'remote' },
  { label: 'Atlanta, GA', value: 'Atlanta', type: 'city' },
  { label: 'Tampa, FL', value: 'Tampa', type: 'city' },
  { label: 'Alpharetta, GA', value: 'Alpharetta', type: 'city' },
  { label: 'Dallas, TX', value: 'Dallas', type: 'city' },
  { label: 'Chicago, IL', value: 'Chicago', type: 'city' },
  { label: 'New York, NY', value: 'New York', type: 'city' },
  { label: 'Seattle, WA', value: 'Seattle', type: 'city' },
  { label: 'Canada', value: 'Canada', type: 'country' },
  { label: 'Remote - Canada', value: 'Canada', type: 'remote' },
  { label: 'India', value: 'India', type: 'country' },
  { label: 'United Kingdom', value: 'United Kingdom', type: 'country' },
  { label: 'Europe', value: 'Europe', type: 'region' },
  { label: 'Remote Global', value: 'Remote Global', type: 'remote' },
  { label: 'New Jersey', value: 'New Jersey', type: 'state' },
  { label: 'New Mexico', value: 'New Mexico', type: 'state' },
  { label: 'Austin, TX', value: 'Austin', type: 'city' },
];

const BROAD_US_LOCATIONS = new Set([
  'united states',
  'united states of america',
  'usa',
  'us',
  'u.s.',
  'u.s.a.',
  'america',
]);

/** Country-wide US queries should not apply strict SQL location matching. */
export function isBroadCountryLocation(input = '') {
  const raw = normalizeKey(input);
  if (BROAD_US_LOCATIONS.has(raw)) return true;
  if (raw.includes('united states') && !/,\s*[a-z]{2}\b/.test(raw)) return true;
  if (raw === 'remote - united states' || raw === 'remote united states') return true;
  return false;
}

function cleanLocation(raw = '') {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(s) {
  return cleanLocation(s).toLowerCase();
}

export function normalizeLocation(raw = '') {
  const text = cleanLocation(raw);
  if (!text) return '';

  const lower = text.toLowerCase();

  for (const [canonical, meta] of Object.entries(REGIONS)) {
    const canonLower = canonical.toLowerCase();
    if (lower === canonLower || lower.includes(canonLower)) return canonical;
    if (meta.aliases.some((a) => lower === a || lower.includes(a))) return canonical;
    if (meta.states.some((s) => lower.includes(s))) return canonical;
    if (meta.cities.some((c) => lower.includes(c))) return canonical;
    if (meta.stateAbbrs.some((ab) => new RegExp(`\\b${ab}\\b`).test(lower))) return canonical;
  }

  if (/\bremote\b/i.test(text) && !Object.keys(REGIONS).some((r) => lower.includes(r.toLowerCase()))) {
    return 'Remote Global';
  }

  return text;
}

export function resolveCanonicalLocation(input = '') {
  const normalized = normalizeLocation(input);
  if (REGIONS[normalized]) return normalized;
  return normalized || cleanLocation(input);
}

export function expandLocationTerms(input = '') {
  const raw = cleanLocation(input);
  if (!raw) return { canonical: '', terms: [] };

  const terms = new Set();
  const lower = raw.toLowerCase();
  terms.add(lower);
  raw
    .split(/[,|]/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 3)
    .forEach((part) => terms.add(part.toLowerCase()));

  const canonical = resolveCanonicalLocation(raw);
  if (canonical) {
    terms.add(canonical.toLowerCase());
    const meta = REGIONS[canonical];
    if (meta) {
      meta.aliases.forEach((a) => terms.add(a));
      meta.states.forEach((s) => terms.add(s));
      meta.stateAbbrs.forEach((a) => terms.add(a));
      meta.cities.forEach((c) => terms.add(c));
    }
  }

  for (const [region, meta] of Object.entries(REGIONS)) {
    const regionLower = region.toLowerCase();
    if (regionLower.includes(lower) || lower.includes(regionLower)) {
      terms.add(regionLower);
      meta.aliases.forEach((a) => terms.add(a));
    }
    meta.aliases.forEach((a) => {
      if (a.includes(lower) || lower.includes(a)) {
        terms.add(a);
        terms.add(regionLower);
      }
    });
    meta.states.forEach((s) => {
      if (s.includes(lower) || lower.includes(s)) terms.add(s);
    });
    meta.cities.forEach((c) => {
      if (c.includes(lower) || lower.includes(c)) terms.add(c);
    });
  }

  if (lower.length >= 2) {
    PRESET_LOCATION_SUGGESTIONS.forEach((s) => {
      if (s.label.toLowerCase().includes(lower)) {
        terms.add(s.label.toLowerCase());
        terms.add(s.value.toLowerCase());
      }
    });
  }

  return {
    canonical: REGIONS[canonical] ? canonical : '',
    terms: [...terms].filter(Boolean).slice(0, 30),
  };
}

function termMatchesHaystack(haystack, term, rawInput = '') {
  const t = term.toLowerCase();
  const input = rawInput.toLowerCase();
  if (t.length <= 2 && t !== input) {
    return new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
  }
  return haystack.includes(t);
}

export function locationMatches(jobLocation = '', normalizedJobLocation = '', filterInput = '') {
  if (!filterInput) return true;
  const haystack = `${jobLocation} ${normalizedJobLocation || ''}`.toLowerCase();
  const { canonical, terms } = expandLocationTerms(filterInput);
  const normLoc = String(normalizedJobLocation || '').toLowerCase();

  if (canonical && normLoc === canonical.toLowerCase()) return true;
  if (canonical && haystack.includes(canonical.toLowerCase())) return true;

  return terms.some((term) => termMatchesHaystack(haystack, term, filterInput));
}

export function buildLocationSqlFilter(locationInput, params, prefix = 'loc') {
  const { canonical, terms } = expandLocationTerms(locationInput);
  if (!terms.length && !canonical) return null;

  const clauses = [];
  if (canonical) {
    params[`${prefix}Canon`] = canonical;
    clauses.push(`normalized_location = @${prefix}Canon`);
  }

  terms.forEach((term, i) => {
    const t = term.toLowerCase();
    const input = locationInput.toLowerCase();
    if (t.length <= 2 && t !== input) return;
    const key = `${prefix}${i}`;
    params[key] = `%${t}%`;
    clauses.push(
      `(LOWER(COALESCE(location,'')) LIKE @${key} OR LOWER(COALESCE(normalized_location,'')) LIKE @${key})`
    );
  });

  if (!clauses.length) return null;
  return `(${clauses.join(' OR ')})`;
}

export function getLocationSuggestions(query = '', { limit = 10, fromDb = [] } = {}) {
  const q = normalizeKey(query);
  const results = [];
  const seen = new Set();

  const add = (item) => {
    const key = item.label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };

  for (const item of PRESET_LOCATION_SUGGESTIONS) {
    const labelLower = item.label.toLowerCase();
    const valueLower = item.value.toLowerCase();
    if (!q || labelLower.includes(q) || valueLower.includes(q) || labelLower.startsWith(q)) {
      add(item);
    }
  }

  for (const loc of fromDb) {
    const label = cleanLocation(loc);
    if (!label) continue;
    const lower = label.toLowerCase();
    if (!q || lower.includes(q) || lower.startsWith(q)) {
      add({ label, value: resolveCanonicalLocation(label) || label, type: 'job' });
    }
  }

  if (q && q.length >= 2 && results.length < 6) {
    for (const item of PRESET_LOCATION_SUGGESTIONS) {
      if (results.length >= 6) break;
      add(item);
    }
  }

  return results.slice(0, limit);
}

export function getLocationDidYouMean(input = '') {
  const raw = cleanLocation(input);
  if (!raw) return [];

  const suggestions = new Set();
  const canonical = resolveCanonicalLocation(raw);
  if (canonical) suggestions.add(canonical);

  const lower = raw.toLowerCase();
  if (lower.includes('united states') || lower.includes('america') || lower === 'usa' || lower === 'us') {
    suggestions.add('United States');
    suggestions.add('Remote - United States');
    suggestions.add('Remote US');
  }
  if (lower.includes('remote')) suggestions.add('Remote Global');

  getLocationSuggestions(raw, { limit: 5 }).forEach((s) => suggestions.add(s.label));

  return [...suggestions].filter((s) => s.toLowerCase() !== lower).slice(0, 5);
}
