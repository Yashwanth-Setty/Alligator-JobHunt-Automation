import { locationMatches } from './locationService.js';

const POSITIVE_VISA = new Set(['positive', 'cpt_friendly', 'sponsorship_friendly']);

/**
 * Why a job is excluded from Recommended / Auto Apply views.
 * @param {object} job - normalized job row
 * @param {object} filters
 * @param {number} threshold
 */
export function computeRejectionReasons(job, filters = {}, threshold = 50) {
  const reasons = [];
  const score = job.score ?? 0;

  if (score < threshold) {
    reasons.push('Score below threshold');
  }

  const visa = (job.visa_fit || 'unknown').toLowerCase();
  if (filters.visaFit === 'positive' && !POSITIVE_VISA.has(visa)) {
    reasons.push(visa === 'unknown' || !visa ? 'Visa unknown' : 'Visa not positive');
  } else if (filters.visaFit === 'negative') {
    const negative = ['negative', 'review', 'no_sponsorship'];
    if (!negative.includes(visa)) {
      reasons.push('Visa not negative');
    }
  }

  if (filters.keywords) {
    const kw = filters.keywords.toLowerCase();
    const text = `${job.title || ''} ${job.company || ''}`.toLowerCase();
    if (!text.includes(kw)) {
      reasons.push('Missing skills');
    }
  }

  if (filters.location) {
    const normalized = job.normalized_location || job.normalizedLocation || '';
    if (!locationMatches(job.location || '', normalized, filters.location)) {
      reasons.push('Location mismatch');
    }
  }

  if (filters.remoteType && job.remote_type && job.remote_type !== filters.remoteType) {
    reasons.push('Work mode mismatch');
  }

  return reasons;
}

export function isRecommended(job, filters = {}, threshold = 50) {
  return computeRejectionReasons(job, filters, threshold).length === 0;
}

export function isAutoApplyEligible(job) {
  return Boolean(job.auto_apply_eligible) && (job.score ?? 0) >= 65;
}

export function aggregateRejectionCounts(jobs, filters, threshold) {
  const counts = {
    scoreBelowThreshold: 0,
    visaUnknown: 0,
    missingSkills: 0,
    locationMismatch: 0,
  };

  for (const job of jobs) {
    const reasons = computeRejectionReasons(job, filters, threshold);
    if (reasons.includes('Score below threshold')) counts.scoreBelowThreshold += 1;
    if (reasons.includes('Visa unknown')) counts.visaUnknown += 1;
    if (reasons.includes('Missing skills')) counts.missingSkills += 1;
    if (reasons.includes('Location mismatch')) counts.locationMismatch += 1;
  }

  return counts;
}
