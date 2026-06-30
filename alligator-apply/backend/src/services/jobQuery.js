import { resolveActiveScanRunId, scanFiltersSignature } from './scanMetrics.js';
import { buildLocationSqlFilter, isBroadCountryLocation } from './locationService.js';

/**
 * Resolve scan run id for job listing — never falls back to unrelated scans or global rows.
 */
export function resolveListScanRunId(filters = {}) {
  if (filters.scanRunId) {
    return String(filters.scanRunId).trim();
  }
  return resolveActiveScanRunId({ filters }) ?? null;
}

/**
 * Shared SQL filter builder for job listing and funnel stats.
 * @param {object} filters
 * @param {'all'|'recommended'|'auto_apply'} tab
 */
export function buildJobWhereClause(filters = {}, tab = 'all') {
  const where = ['1=1'];
  const params = {};
  const threshold = Number(filters.minScore || 50);

  if (filters.keywords) {
    where.push('(LOWER(title) LIKE @kw OR LOWER(company) LIKE @kw)');
    params.kw = `%${filters.keywords.toLowerCase()}%`;
  }
  if (filters.location && !isBroadCountryLocation(filters.location)) {
    const locFilter = buildLocationSqlFilter(filters.location, params);
    if (locFilter) where.push(locFilter);
  }
  if (filters.company) {
    where.push('LOWER(company) LIKE @co');
    params.co = `%${filters.company.toLowerCase()}%`;
  }
  if (filters.source) {
    where.push('source = @source');
    params.source = filters.source;
  }
  if (filters.remoteType) {
    where.push('remote_type = @remoteType');
    params.remoteType = filters.remoteType;
  }
  if (filters.employmentType) {
    where.push('employment_type = @employmentType');
    params.employmentType = filters.employmentType;
  }
  if (filters.experienceLevel) {
    where.push('experience_level = @experienceLevel');
    params.experienceLevel = filters.experienceLevel;
  }
  if (filters.datePostedDays) {
    where.push("date_posted >= date('now', @dateOffset)");
    params.dateOffset = `-${Number(filters.datePostedDays)} days`;
  }
  if (filters.salaryMin) {
    where.push('(salary_max IS NULL OR salary_max >= @salaryMin)');
    params.salaryMin = Number(filters.salaryMin);
  }
  if (filters.salaryMax) {
    where.push('(salary_min IS NULL OR salary_min <= @salaryMax)');
    params.salaryMax = Number(filters.salaryMax);
  }
  if (filters.pipelineStatus) {
    where.push('pipeline_status = @pipelineStatus');
    params.pipelineStatus = filters.pipelineStatus;
  }

  if (filters.includeHidden !== 'true') {
    where.push('COALESCE(is_hidden, 0) = 0');
  }

  const scanRunId = resolveListScanRunId(filters);
  if (scanRunId) {
    where.push('scan_run_id = @scanRunId');
    params.scanRunId = scanRunId;
  } else if (filters.savedOnly !== 'true') {
    // No valid scan scope — never return global/unscoped job rows for hunt results.
    where.push('1=0');
  }

  if (filters.savedOnly === 'true') {
    where.push('is_saved = 1');
  }

  // Tab-specific filters — All Jobs never applies score or visa filters
  if (tab === 'recommended') {
    where.push('score >= @minScore');
    params.minScore = threshold;
    applyVisaFilter(filters, where, params);
  } else if (tab === 'auto_apply') {
    where.push('auto_apply_eligible = 1');
    where.push('score >= 65');
  }

  return { whereSql: where.join(' AND '), params, threshold };
}

/** Build WHERE clause optionally skipping keyword and/or location filters. */
export function buildJobWhereClauseOmitting(filters = {}, tab = 'all', { omitKeywords = false, omitLocation = false } = {}) {
  const f = { ...filters };
  if (omitKeywords) delete f.keywords;
  if (omitLocation) delete f.location;
  return buildJobWhereClause(f, tab);
}

function applyVisaFilter(filters, where, params) {
  if (!filters.visaFit) return;
  const positive = ['positive', 'cpt_friendly', 'sponsorship_friendly'];
  const negative = ['negative', 'review', 'no_sponsorship'];
  if (filters.visaFit === 'positive') {
    where.push(`visa_fit IN (${positive.map((_, i) => `@vf${i}`).join(', ')})`);
    positive.forEach((v, i) => { params[`vf${i}`] = v; });
  } else if (filters.visaFit === 'negative') {
    where.push(`visa_fit IN (${negative.map((_, i) => `@vn${i}`).join(', ')})`);
    negative.forEach((v, i) => { params[`vn${i}`] = v; });
  } else {
    where.push('(visa_fit = @visaFit OR visa_fit IS NULL OR visa_fit = \'\')');
    params.visaFit = filters.visaFit;
  }
}

/** Base filters only (no tab/score/visa restrictions) — for All Jobs counts. */
export function buildBaseWhereClause(filters = {}) {
  return buildJobWhereClause(filters, 'all');
}

const SORT_COLUMNS = {
  score: 'score',
  date_posted: 'date_posted',
  salary: 'COALESCE(salary_max, salary_min, 0)',
  company: 'company',
  location: 'location',
};

export function buildSortClause(sortBy = 'score', sortOrder = 'desc') {
  const col = SORT_COLUMNS[sortBy] || SORT_COLUMNS.score;
  const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';
  if (sortBy === 'date_posted') {
    return `date_posted IS NULL, date_posted ${dir}, score DESC`;
  }
  return `${col} ${dir}, score DESC`;
}
