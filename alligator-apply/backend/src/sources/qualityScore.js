import { detectVisaSignals } from './visaSignals.js';
import {
  calculateResumeMatchScore,
  isAutoApplyMatch,
  parseFilterKeywords,
} from './matchScore.js';

const CLOSED_PATTERNS = /\b(position filled|no longer accepting|job closed|requisition closed|expired)\b/i;

/** Metadata completeness score (0–100) — not resume relevance. */
export function calculateQualityScore(job, opts = {}) {
  let score = 0;
  const checks = {
    hasApplyUrl: Boolean(job.applyUrl?.trim()),
    hasDescription: Boolean((job.description || '').trim().length > 40),
    hasLocation: Boolean((job.location || '').trim()),
    hasCompany: Boolean((job.company || '').trim()),
    hasTitle: Boolean((job.title || '').trim()),
    recentPostedDate: isRecentDate(job.postedDate),
    notDuplicate: !opts.isDuplicate,
    notClosed: !isClosedJob(job),
  };

  if (checks.hasApplyUrl) score += 20;
  if (checks.hasDescription) score += 20;
  if (checks.hasLocation) score += 15;
  if (checks.hasCompany) score += 15;
  if (checks.hasTitle) score += 10;
  if (checks.recentPostedDate) score += 10;
  if (checks.notDuplicate) score += 5;
  if (checks.notClosed) score += 5;

  return { score: Math.min(100, score), checks };
}

function isRecentDate(dateStr, maxDays = 90) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const days = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 0 && days <= maxDays;
}

function isClosedJob(job) {
  const text = `${job.title || ''} ${job.description || ''}`;
  if (CLOSED_PATTERNS.test(text)) return true;
  if (job.rawData?.state === 'closed' || job.rawData?.status === 'closed') return true;
  return false;
}

function resolveScore(job, match, quality) {
  if (match.matchedSkills?.length > 0 || (match.score ?? 0) > 0) {
    return Math.round(match.score * 0.75 + quality.score * 0.25);
  }
  return Math.min(match.score ?? 0, quality.score);
}

export function lightEnrichJob(job, enrichOpts = {}) {
  const keywords = enrichOpts.resumeKeywords || parseFilterKeywords(enrichOpts.keywords);
  const match = calculateResumeMatchScore(job, {
    keywords,
    preferredLocation: enrichOpts.preferredLocation || enrichOpts.location,
    skillSource: enrichOpts.skillSource,
  });
  const quality = calculateQualityScore(job, {});
  const visa = job.visaSignals?.fit
    ? job.visaSignals
    : { fit: 'unknown', sponsorshipMentioned: false, cptMentioned: false };
  const score = resolveScore(job, match, quality);

  return {
    ...job,
    visaSignals: visa,
    qualityScore: quality.score,
    qualityChecks: quality.checks,
    matchBreakdown: match.breakdown,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    scoreSkillSource: match.skillSource,
    score,
    autoApplyEligible: isAutoApplyMatch(score, job),
    enrichmentPending: true,
  };
}

export function enrichJobQuality(job, opts = {}) {
  const description = job.description || '';
  const visa = job.visaSignals?.fit
    ? { ...job.visaSignals, fit: normalizeVisaFit(job.visaSignals.fit) }
    : detectVisaSignals(description);

  const keywords = opts.resumeKeywords || parseFilterKeywords(opts.keywords);
  const withVisa = { ...job, visaSignals: visa };
  const match = calculateResumeMatchScore(withVisa, {
    keywords,
    preferredLocation: opts.preferredLocation || opts.location,
    skillSource: opts.skillSource,
  });
  const quality = calculateQualityScore(withVisa, opts);
  const score = resolveScore(withVisa, match, quality);

  return {
    ...withVisa,
    visaSignals: {
      fit: visa.fit,
      sponsorshipMentioned: visa.sponsorshipMentioned ?? false,
      cptMentioned: visa.cptMentioned ?? false,
    },
    qualityScore: quality.score,
    qualityChecks: quality.checks,
    matchBreakdown: match.breakdown,
    matchedSkills: match.matchedSkills,
    missingSkills: match.missingSkills,
    scoreSkillSource: match.skillSource,
    score,
    autoApplyEligible: isAutoApplyMatch(score, withVisa),
    enrichmentPending: false,
  };
}

function normalizeVisaFit(fit) {
  const v = String(fit || '').toLowerCase();
  if (v === 'positive' || v === 'negative' || v === 'unknown') return v;
  if (v.includes('cpt') || v.includes('sponsor')) return 'positive';
  if (v === 'review') return 'negative';
  return 'unknown';
}
