export const KEYWORD_SUGGESTIONS = [
  'Backend Engineer',
  'Java Backend Developer',
  'Full Stack Java Developer',
  'AI Engineer',
  'AI Backend Engineer',
  'AI Platform Engineer',
  'LLM Engineer',
  'ML Engineer',
  'Machine Learning Engineer',
  'Generative AI Engineer',
  'Applied AI Engineer',
  'Platform Engineer',
  'Cloud Engineer',
  'Cybersecurity Engineer',
  'DevOps Engineer',
  'Data Engineer',
  'Software Engineer',
];

export const LOCATION_SUGGESTIONS = [
  'United States',
  'Remote - United States',
  'Atlanta, GA',
  'Alpharetta, GA',
  'Dallas, TX',
  'Austin, TX',
  'Houston, TX',
  'Chicago, IL',
  'New York, NY',
  'Jersey City, NJ',
  'Boston, MA',
  'Seattle, WA',
  'San Francisco, CA',
  'San Jose, CA',
  'Los Angeles, CA',
  'Phoenix, AZ',
  'Charlotte, NC',
  'Raleigh, NC',
  'Miami, FL',
  'Tampa, FL',
];

export const SOURCE_LABELS = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  smartrecruiters: 'SmartRecruiters',
  workday: 'Workday',
};

export function formatLiveSources(sources = []) {
  return sources.map((s) => SOURCE_LABELS[s] || s).join(', ');
}

const AI_TYPED_SUGGESTIONS = [
  'AI Engineer',
  'AI Backend Engineer',
  'AI Platform Engineer',
  'LLM Engineer',
  'Machine Learning Engineer',
  'Generative AI Engineer',
  'Applied AI Engineer',
];

function normalizeMatchText(text = '') {
  return String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function filterKeywordSuggestions(query = '', limit = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  if (q.startsWith('ai')) {
    const aiMatches = AI_TYPED_SUGGESTIONS.filter(
      (item) => q.length <= 2 || item.toLowerCase().includes(q)
    );
    const other = KEYWORD_SUGGESTIONS.filter(
      (item) => item.toLowerCase().includes(q) && !aiMatches.includes(item)
    );
    return [...aiMatches, ...other].slice(0, limit);
  }

  return KEYWORD_SUGGESTIONS.filter((item) => item.toLowerCase().includes(q)).slice(0, limit);
}

export function filterLocationSuggestions(query = '', limit = 12) {
  const q = query.trim();
  const qNorm = normalizeMatchText(q);
  if (!qNorm) return [];

  return LOCATION_SUGGESTIONS.filter((item) => {
    const itemNorm = normalizeMatchText(item);
    return itemNorm.includes(qNorm) || item.toLowerCase().includes(q.toLowerCase());
  }).slice(0, limit);
}
