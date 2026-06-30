/**
 * Workday public CXS API helpers (Phase 2B).
 */

export const WORKDAY_MAX_PAGE_SIZE = 20;

const WD_INSTANCE_RE = /^wd\d+$/i;

/**
 * @typedef {object} WorkdayConnectionConfig
 * @property {string} tenant
 * @property {string} wdInstance
 * @property {string} hostSlug
 * @property {string} site
 * @property {string} locale
 * @property {number} pageSize
 * @property {boolean} fetchDetails
 * @property {object} defaultFacets
 * @property {string} [boardToken]
 * @property {string} [companyName]
 */

/**
 * @param {object} payload
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateWorkdayPayload(payload = {}) {
  const tenant = String(payload.tenant || '').trim();
  const wdInstance = String(payload.wdInstance || '').trim();
  const site = String(payload.site || '').trim();
  const hostSlug = String(payload.hostSlug || payload.tenant || '').trim();

  if (!tenant) return { valid: false, error: 'connectionPayload.tenant is required' };
  if (!wdInstance) return { valid: false, error: 'connectionPayload.wdInstance is required' };
  if (!WD_INSTANCE_RE.test(wdInstance)) {
    return { valid: false, error: 'connectionPayload.wdInstance must match wd{N} (e.g. wd5)' };
  }
  if (!site) return { valid: false, error: 'connectionPayload.site is required' };
  if (!hostSlug) return { valid: false, error: 'connectionPayload.hostSlug is required' };

  if (payload.pageSize != null) {
    const pageSize = Number(payload.pageSize);
    if (Number.isNaN(pageSize) || pageSize < 1 || pageSize > WORKDAY_MAX_PAGE_SIZE) {
      return { valid: false, error: `connectionPayload.pageSize must be 1-${WORKDAY_MAX_PAGE_SIZE}` };
    }
  }

  return { valid: true };
}

/**
 * @param {string|import('./providers/providerContract.js').ProviderTarget|object} target
 * @returns {WorkdayConnectionConfig}
 */
export function resolveWorkdayTarget(target) {
  const base = typeof target === 'string' ? { boardToken: target } : target || {};
  const payload = base.connectionPayload || base.payload || {};

  const tenant = String(payload.tenant || '').trim();
  const wdInstance = String(payload.wdInstance || '').trim().toLowerCase();
  const site = String(payload.site || '').trim();
  const hostSlug = String(payload.hostSlug || tenant).trim();
  const locale = String(payload.locale || 'en-US').trim() || 'en-US';
  const pageSize = Math.min(
    WORKDAY_MAX_PAGE_SIZE,
    Math.max(1, Number(payload.pageSize) || WORKDAY_MAX_PAGE_SIZE)
  );

  const config = {
    tenant,
    wdInstance,
    hostSlug,
    site,
    locale,
    pageSize,
    fetchDetails: Boolean(payload.fetchDetails),
    defaultFacets: payload.defaultFacets && typeof payload.defaultFacets === 'object'
      ? payload.defaultFacets
      : {},
    boardToken: base.boardToken || `${tenant}::${site}`,
    companyName: base.companyName || base.company_name || '',
  };

  const validation = validateWorkdayPayload(config);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return config;
}

export function buildWorkdayHost(config) {
  const c = typeof config.tenant === 'string' ? config : resolveWorkdayTarget(config);
  return `https://${c.hostSlug}.${c.wdInstance}.myworkdayjobs.com`;
}

export function buildWorkdayCareersUrl(config) {
  const c = typeof config.tenant === 'string' ? config : resolveWorkdayTarget(config);
  return `${buildWorkdayHost(c)}/${c.locale}/${c.site}`;
}

/**
 * POST endpoint for job listings.
 * @param {WorkdayConnectionConfig|object} config
 */
export function buildCxsJobsUrl(config) {
  const c = typeof config.tenant === 'string' ? config : resolveWorkdayTarget(config);
  return `${buildWorkdayHost(c)}/wday/cxs/${encodeURIComponent(c.tenant)}/${encodeURIComponent(c.site)}/jobs`;
}

/**
 * GET endpoint for a single job detail.
 * @param {WorkdayConnectionConfig|object} config
 * @param {string} externalPath
 */
export function buildCxsJobDetailUrl(config, externalPath) {
  const c = typeof config.tenant === 'string' ? config : resolveWorkdayTarget(config);
  const path = String(externalPath || '').trim();
  if (!path) throw new Error('externalPath is required');
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${buildWorkdayHost(c)}/wday/cxs/${encodeURIComponent(c.tenant)}/${encodeURIComponent(c.site)}/job${normalized}`;
}

export function buildWorkdayApplyUrl(config, externalPath) {
  const c = typeof config.tenant === 'string' ? config : resolveWorkdayTarget(config);
  const path = String(externalPath || '').trim();
  if (!path) return buildWorkdayCareersUrl(c);
  if (path.startsWith('http')) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${buildWorkdayHost(c)}${normalized}`;
}

export function buildWorkdayBoardToken(tenant, site) {
  return `${String(tenant).trim()}::${String(site).trim()}`;
}

export function buildWorkdayCareersUrlFromPayload(payload) {
  return buildWorkdayCareersUrl(resolveWorkdayTarget({ connectionPayload: payload }));
}

/**
 * @param {string|import('./providers/providerContract.js').ProviderTarget|object} target
 */
export function validateWorkdayTarget(target) {
  try {
    resolveWorkdayTarget(target);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

export function extractRequisitionId(posting = {}) {
  const bullets = Array.isArray(posting.bulletFields) ? posting.bulletFields : [];
  for (const field of bullets) {
    const value = String(field || '').trim();
    if (/^(JR_|REQ|R-)/i.test(value)) return value;
  }
  return bullets[0] ? String(bullets[0]).trim() : '';
}

export function parseWorkdayPostedDate(postedOn = '') {
  const raw = String(postedOn || '').trim();
  if (!raw) return null;
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  return null;
}

export function workdaySearchText(filters = {}, payload = {}) {
  const fromFilters = String(filters.keywords || '').trim();
  if (fromFilters) return fromFilters;
  return String(payload.searchTextFallback || '').trim();
}

export function buildCxsJobsRequestBody(filters = {}, config = {}, offset = 0) {
  const c = typeof config.tenant === 'string' ? config : resolveWorkdayTarget(config);
  return {
    appliedFacets: c.defaultFacets || {},
    limit: c.pageSize,
    offset,
    searchText: workdaySearchText(filters, c),
  };
}
