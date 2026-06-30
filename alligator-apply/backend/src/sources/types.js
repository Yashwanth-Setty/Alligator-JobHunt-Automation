import crypto from 'crypto';
import { mapLegacyVisaFit } from './visaSignals.js';
import { normalizeLocation as canonicalLocation } from '../services/locationService.js';

/**
 * @typedef {Object} JobSalary
 * @property {number|null} min
 * @property {number|null} max
 * @property {string} currency
 * @property {string|null} display
 */

/**
 * @typedef {Object} VisaSignals
 * @property {string} fit - cpt_friendly | sponsorship_friendly | review | unknown
 * @property {boolean} sponsorshipMentioned
 * @property {boolean} cptMentioned
 */

/**
 * Unified job schema used across all source adapters.
 * @typedef {Object} Job
 * @property {string} id
 * @property {string} source
 * @property {string} atsType
 * @property {string} company
 * @property {string} title
 * @property {string} location
 * @property {string} workMode - remote | hybrid | onsite | ''
 * @property {string} employmentType
 * @property {JobSalary} salary
 * @property {string} description
 * @property {string} applyUrl
 * @property {string|null} postedDate
 * @property {VisaSignals} visaSignals
 * @property {object} rawData
 * @property {number} [score]
 * @property {string} [experienceLevel]
 * @property {boolean} [autoApplyEligible]
 */

/**
 * @typedef {Object} SearchFilters
 * @property {string} [keywords]
 * @property {string} [location]
 * @property {string} [company]
 * @property {string} [remoteType]
 * @property {string} [visaFit]
 * @property {string} [employmentType]
 * @property {string} [experienceLevel]
 * @property {number} [minScore]
 * @property {number} [salaryMin]
 * @property {number} [salaryMax]
 */

/**
 * @typedef {Object} SearchOptions
 * @property {number} [page]
 * @property {number} [limit]
 */

/**
 * @typedef {Object} SearchResult
 * @property {Job[]} jobs
 * @property {number} page
 * @property {number} limit
 * @property {number} total
 * @property {boolean} hasMore
 */

/**
 * @typedef {Object} SourceScanStatus
 * @property {string} name
 * @property {'pending'|'scanning'|'completed'|'failed'|'skipped'} status
 * @property {number} jobsFound
 * @property {number} [durationMs]
 * @property {string} [error]
 */

export function createJobId(source, company, title, applyUrl) {
  const raw = `${source}:${company}:${title}:${applyUrl}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

export function emptySalary() {
  return { min: null, max: null, currency: 'USD', display: null };
}

export function emptyVisaSignals() {
  return { fit: 'unknown', sponsorshipMentioned: false, cptMentioned: false };
}

/** Default pipeline status for newly scanned jobs (never auto_applied). */
export function defaultPipelineStatus(score, eligible) {
  if (score >= 65 && eligible) return 'ready_to_apply';
  if (score >= 50) return 'matched';
  return 'found';
}

/** Map unified Job → SQLite jobs row fields */
export function jobToDbRow(job, ts = new Date().toISOString()) {
  const score = job.score ?? 0;
  const eligible =
    job.autoApplyEligible ??
    (score >= 65 && Boolean(job.applyUrl) && !job.applyUrl.toLowerCase().includes('workday'));
  const pipeline = defaultPipelineStatus(score, eligible);
  const dataSource =
    job.dataSource ||
    (String(job.id || '').startsWith('mock-') ? 'mock' : 'live');

  return {
    id: job.id,
    company: job.company,
    title: job.title,
    url: job.applyUrl,
    source: job.source,
    score,
    location: job.location,
    normalized_location: canonicalLocation(job.location || ''),
    remote_type: job.workMode || '',
    employment_type: job.employmentType || '',
    experience_level: job.experienceLevel || '',
    visa_fit: job.visaSignals?.fit || 'unknown',
    auto_apply_eligible: eligible ? 1 : 0,
    pipeline_status: pipeline,
    data_source: dataSource,
    salary_min: job.salary?.min ?? null,
    salary_max: job.salary?.max ?? null,
    date_posted: job.postedDate || null,
    description: (job.description || '').slice(0, 50000),
    quality_checks: job.qualityChecks ? JSON.stringify(job.qualityChecks) : null,
    created_at: ts,
    updated_at: ts,
  };
}

export function legacyMockToJob(row) {
  const applyUrl = row.url || row.applyUrl || '';
  return {
    id: row.id || createJobId(row.source, row.company, row.title, applyUrl),
    source: row.source,
    atsType: row.atsType || row.source,
    company: row.company,
    title: row.title,
    location: row.location || '',
    workMode: row.remote_type || row.workMode || '',
    employmentType: row.employment_type || row.employmentType || '',
    salary: {
      min: row.salary_min ?? row.salary?.min ?? null,
      max: row.salary_max ?? row.salary?.max ?? null,
      currency: 'USD',
      display: row.salary?.display ?? null,
    },
    description: row.description || '',
    applyUrl,
    postedDate: row.date_posted || row.postedDate || null,
    visaSignals: {
      fit: mapLegacyVisaFit(row.visa_fit || row.visaSignals?.fit || 'unknown'),
      sponsorshipMentioned: Boolean(row.visaSignals?.sponsorshipMentioned),
      cptMentioned: Boolean(row.visaSignals?.cptMentioned),
    },
    rawData: row,
    score: row.score ?? 0,
    experienceLevel: row.experience_level || row.experienceLevel || '',
    autoApplyEligible: Boolean(row.auto_apply_eligible ?? row.autoApplyEligible),
    dataSource: 'mock',
  };
}
