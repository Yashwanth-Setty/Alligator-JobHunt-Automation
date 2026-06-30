/**
 * Job filtering for fetch vs display stages.
 * Fetch filters must NOT use minScore (jobs are unscored at fetch time).
 */

import { locationMatches } from '../services/locationService.js';
import {
  matchesPermissiveKeywordFilter,
  passesPermissiveLocationFilter,
} from './earlyFilter.js';

export function parseKeywordTerms(keywords = '') {
  return String(keywords || '')
    .split(/[,;\n|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Filters safe for adapter fetch — excludes score threshold. */
export function buildFetchFilters(filters = {}) {
  const { minScore, tab, page, limit, sortBy, sortOrder, ...rest } = filters;
  return rest;
}

function visaFitMatches(jobFit, filterFit) {
  if (jobFit === filterFit) return true;
  const positive = new Set(['positive', 'cpt_friendly', 'sponsorship_friendly']);
  const negative = new Set(['negative', 'review']);
  if (filterFit === 'positive' && positive.has(jobFit)) return true;
  if (filterFit === 'negative' && negative.has(jobFit)) return true;
  return false;
}

function jobSearchText(job) {
  return `${job.title || ''} ${job.company || ''} ${job.description || ''}`.toLowerCase();
}

/**
 * @returns {{ pass: boolean, reason?: string, category?: string }}
 */
export function getFetchFilterResult(job, filters = {}, options = {}) {
  const { forFetch = false } = options;

  if (!filters || Object.keys(filters).length === 0) {
    if (!job.applyUrl?.trim()) return { pass: false, reason: 'invalid URL', category: 'invalidUrl' };
    return { pass: true };
  }

  if (!job.applyUrl?.trim()) {
    return { pass: false, reason: 'invalid URL', category: 'invalidUrl' };
  }

  if (filters.keywords) {
    const text = jobSearchText(job);
    const keywordPass = forFetch
      ? matchesPermissiveKeywordFilter(text, filters.keywords)
      : parseKeywordTerms(filters.keywords).some((term) => text.includes(term));
    if (!keywordPass) {
      return { pass: false, reason: 'keyword mismatch', category: 'keywordMismatch' };
    }
  }

  if (filters.location) {
    const normalized = job.normalizedLocation || job.normalized_location || '';
    const locationPass = forFetch
      ? passesPermissiveLocationFilter(job.location || '', normalized, filters.location)
      : locationMatches(job.location || '', normalized, filters.location);
    if (!locationPass) {
      return { pass: false, reason: 'location mismatch', category: 'locationMismatch' };
    }
  }

  if (filters.company) {
    const co = (job.company || '').toLowerCase();
    if (!co.includes(filters.company.toLowerCase())) {
      return { pass: false, reason: 'company mismatch', category: 'companyMismatch' };
    }
  }

  if (filters.source && job.source !== filters.source) {
    return { pass: false, reason: 'source mismatch', category: 'sourceMismatch' };
  }

  if (filters.remoteType && job.workMode && job.workMode !== filters.remoteType) {
    return { pass: false, reason: 'work mode mismatch', category: 'remoteTypeMismatch' };
  }

  if (filters.visaFit) {
    const jobFit = job.visaSignals?.fit || 'unknown';
    if (!visaFitMatches(jobFit, filters.visaFit)) {
      return { pass: false, reason: 'visa mismatch', category: 'visaMismatch' };
    }
  }

  if (filters.employmentType && job.employmentType && job.employmentType !== filters.employmentType) {
    return { pass: false, reason: 'employment type mismatch', category: 'employmentTypeMismatch' };
  }

  if (filters.experienceLevel && job.experienceLevel && job.experienceLevel !== filters.experienceLevel) {
    return { pass: false, reason: 'experience level mismatch', category: 'experienceLevelMismatch' };
  }

  if (filters.salaryMin && (job.salary?.max || 0) < Number(filters.salaryMin)) {
    return { pass: false, reason: 'salary below minimum', category: 'salaryMismatch' };
  }

  if (filters.salaryMax && (job.salary?.min || 999999) > Number(filters.salaryMax)) {
    return { pass: false, reason: 'salary above maximum', category: 'salaryMismatch' };
  }

  return { pass: true };
}

const EMPTY_COUNTS = () => ({
  keywordMismatch: 0,
  locationMismatch: 0,
  companyMismatch: 0,
  sourceMismatch: 0,
  remoteTypeMismatch: 0,
  visaMismatch: 0,
  employmentTypeMismatch: 0,
  experienceLevelMismatch: 0,
  scoreBelowThreshold: 0,
  salaryMismatch: 0,
  invalidUrl: 0,
  duplicate: 0,
});

export function filterJobsWithStats(jobs, filters = {}, options = {}) {
  const { forFetch = true, threshold = Number(filters.minScore || 50) } = options;
  const counts = EMPTY_COUNTS();
  const kept = [];
  const rejected = [];

  for (const job of jobs) {
    const fetchResult = getFetchFilterResult(
      job,
      forFetch ? buildFetchFilters(filters) : filters,
      { forFetch }
    );
    if (!fetchResult.pass) {
      counts[fetchResult.category] = (counts[fetchResult.category] || 0) + 1;
      rejected.push({ job, reason: fetchResult.reason, category: fetchResult.category });
      continue;
    }

    if (!forFetch && filters.minScore && (job.score ?? 0) < threshold) {
      counts.scoreBelowThreshold += 1;
      rejected.push({ job, reason: 'score below threshold', category: 'scoreBelowThreshold' });
      continue;
    }

    kept.push(job);
  }

  return { jobs: kept, rejected, rejectionCounts: counts };
}

export function mergeRejectionCounts(a = {}, b = {}) {
  const out = EMPTY_COUNTS();
  for (const key of Object.keys(out)) {
    out[key] = (a[key] || 0) + (b[key] || 0);
  }
  return out;
}
