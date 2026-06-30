/**
 * Resume-weighted match scoring (0–100).
 * Skills come from parsed resume; DEFAULT_SKILLS used only when parsing failed.
 */

import { locationMatches, normalizeLocation } from '../services/locationService.js';

const SALES_TITLE =
  /\b(sales|business development|account executive|bdr|sdr|recruiter|customer success|product support specialist|renewals|partnerships)\b/i;
const ENG_TITLE =
  /\b(software|engineer|developer|full.?stack|backend|frontend|devops|sre|platform|data engineer|ml engineer|ai engineer|architect)\b/i;

export const DEFAULT_SKILLS = [
  'java',
  'spring',
  'spring boot',
  'aws',
  'react',
  'full stack',
  'fullstack',
  'ai',
  'javascript',
  'typescript',
  'python',
  'node',
  'kubernetes',
];

/** Parse user-entered filter keywords only (no resume, no defaults). */
export function parseFilterKeywords(keywordsInput = '') {
  return String(keywordsInput || '')
    .split(/[,;\n|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @deprecated Use resolveScoringSkills + getResumeScoringContext instead.
 * Kept for backward compatibility — returns filter terms + fallback defaults only.
 */
export function parseResumeKeywords(keywordsInput = '') {
  const { skills } = resolveScoringSkills({
    resumeSkills: [],
    filterKeywords: keywordsInput,
    parseSucceeded: false,
  });
  return skills;
}

/**
 * @param {{ resumeSkills?: string[], filterKeywords?: string, parseSucceeded?: boolean }} params
 */
export function resolveScoringSkills({ resumeSkills = [], filterKeywords = '', parseSucceeded = false } = {}) {
  const filterTerms = parseFilterKeywords(filterKeywords);
  let baseSkills = [];
  let skillSource = 'fallback';

  if (parseSucceeded && resumeSkills.length > 0) {
    baseSkills = resumeSkills;
    skillSource = 'resume';
  } else {
    baseSkills = [...DEFAULT_SKILLS];
    skillSource = 'fallback';
  }

  const merged = [...new Set([...baseSkills, ...filterTerms].map((s) => s.trim()).filter(Boolean))];
  return { skills: merged.slice(0, 40), skillSource };
}

function skillMatches(text, skill) {
  return text.includes(String(skill).toLowerCase());
}

/**
 * @param {import('./types.js').Job} job
 * @param {{ keywords?: string[]|string, preferredLocation?: string, skillSource?: string }} [opts]
 */
export function calculateResumeMatchScore(job, opts = {}) {
  const skills = Array.isArray(opts.keywords)
    ? opts.keywords
    : resolveScoringSkills({
        resumeSkills: [],
        filterKeywords: opts.keywords || '',
        parseSucceeded: false,
      }).skills;

  const title = job.title || '';
  const text = `${title} ${job.description || ''} ${job.company || ''}`.toLowerCase();

  const matchedSkills = skills.filter((s) => skillMatches(text, s));
  const missingSkills = skills.filter((s) => !skillMatches(text, s));
  const skillScore =
    skills.length > 0 ? Math.round((matchedSkills.length / skills.length) * 40) : 0;

  let titleScore = 8;
  let titleDetail = 'Neutral title alignment';
  if (ENG_TITLE.test(title)) {
    titleScore = 25;
    titleDetail = 'Engineering/technical title — strong alignment';
  } else if (SALES_TITLE.test(title)) {
    titleScore = 4;
    titleDetail = 'Sales/non-engineering title — weak alignment';
  }

  let expScore = 10;
  const exp = (job.experienceLevel || '').toLowerCase();
  if (exp === 'senior' || exp === 'staff') expScore = 12;
  else if (exp === 'entry' || exp === 'intern') expScore = 8;

  const pref = (opts.preferredLocation || '').trim();
  const jobLoc = job.location || '';
  const normalizedJobLoc = normalizeLocation(jobLoc);
  let locationScore = 0;
  let locationDetail = 'No location on job listing';
  if (jobLoc) {
    if (pref && locationMatches(jobLoc, normalizedJobLoc, pref)) {
      locationScore = 10;
      locationDetail = `Matches preferred location (${pref})`;
    } else if (/remote/i.test(jobLoc)) {
      locationScore = 9;
      locationDetail = pref
        ? `Remote role (preferred: ${pref})`
        : 'Remote role';
    } else if (pref) {
      locationScore = 4;
      locationDetail = `Does not match preferred location (${pref})`;
    } else {
      locationScore = 6;
      locationDetail = `${jobLoc}`;
    }
  } else if (pref) {
    locationDetail = `Preferred ${pref}; job location not listed`;
  }

  let visaScore = 5;
  let visaDetail = 'Visa sponsorship unknown';
  const visa = job.visaSignals?.fit || job.visa_fit || 'unknown';
  if (visa === 'positive' || String(visa).includes('cpt') || String(visa).includes('sponsor')) {
    visaScore = 10;
    visaDetail = 'Sponsorship-friendly signals detected';
  } else if (visa === 'negative' || visa === 'review') {
    visaScore = 0;
    visaDetail = 'No sponsorship or restrictive visa language';
  }

  const score = Math.min(100, skillScore + titleScore + expScore + locationScore + visaScore);
  const skillSource = opts.skillSource || 'fallback';
  const matchedPreview = matchedSkills.slice(0, 8).join(', ') || 'none';
  const missingPreview = missingSkills.slice(0, 8).join(', ') || 'none';

  return {
    score,
    matchedSkills,
    missingSkills,
    skillSource,
    breakdown: [
      {
        label: 'Skills match',
        points: skillScore,
        max: 40,
        detail: `${matchedSkills.length}/${skills.length} matched (${skillSource}) — ${matchedPreview}`,
      },
      {
        label: 'Missing skills',
        points: 0,
        max: skills.length,
        detail: missingPreview,
      },
      {
        label: 'Title alignment',
        points: titleScore,
        max: 25,
        detail: titleDetail,
      },
      {
        label: 'Location alignment',
        points: locationScore,
        max: 10,
        detail: locationDetail,
      },
      {
        label: 'Visa signals',
        points: visaScore,
        max: 10,
        detail: visaDetail,
      },
      {
        label: 'Experience fit',
        points: expScore,
        max: 15,
        detail: exp ? `${exp} level role` : 'Experience level not specified',
      },
    ],
  };
}

export function isRecommendedMatch(score, threshold = 50) {
  return score >= threshold;
}

export function isAutoApplyMatch(score, job) {
  return score >= 65 && Boolean(job.applyUrl) && job.autoApplyEligible !== false;
}
