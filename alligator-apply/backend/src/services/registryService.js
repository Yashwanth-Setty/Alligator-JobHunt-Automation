import {
  buildCareersUrl,
  SUPPORTED_IMPORT_SOURCES,
} from './companyRegistry/registryImport.js';
import {
  validateWorkdayPayload,
  buildWorkdayBoardToken,
  buildWorkdayCareersUrlFromPayload,
} from '../sources/workdayCxs.js';
import {
  countCompanies,
  countRegistryEntriesFiltered,
  createCompany,
  createRegistryEntry,
  getCompanyById,
  getRegistryEntryById,
  getRegistryStatsSummary,
  listCompanies,
  listCompanyTags,
  listRegistryEntries,
  toggleRegistryEntry,
  updateRegistryEntry,
} from './companyRegistry/registryStore.js';

const SUPPORTED_SOURCES = [...SUPPORTED_IMPORT_SOURCES, 'workday'];

function parseEnabledFilter(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return undefined;
}

function parseLimit(value, defaultLimit = 100) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 1) return defaultLimit;
  return Math.min(n, 500);
}

function parseOffset(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

function assertSupportedSource(source) {
  const src = String(source || '').trim().toLowerCase();
  if (!SUPPORTED_SOURCES.includes(src)) {
    throw new Error(`Unsupported source "${source}". Use: ${SUPPORTED_SOURCES.join(', ')}`);
  }
  return src;
}

export function getRegistryTagsResponse() {
  return { tags: listCompanyTags() };
}

export function getCompaniesResponse(query = {}) {
  const filters = {
    search: query.search || query.q || undefined,
    industry: query.industry || undefined,
    tag: query.tag || undefined,
    limit: parseLimit(query.limit),
    offset: parseOffset(query.offset),
  };

  return {
    companies: listCompanies(filters),
    total: countCompanies(filters),
    limit: filters.limit,
    offset: filters.offset,
  };
}

export function createCompanyFromBody(body = {}) {
  const company = createCompany({
    name: body.name,
    domain: body.domain,
    industry: body.industry,
    visaSponsorHint: body.visaSponsorHint,
    remotePolicy: body.remotePolicy,
    notes: body.notes,
    tags: body.tags,
  });
  return { company, created: true };
}

export function getEntriesResponse(query = {}) {
  const filters = {
    source: query.source || undefined,
    companyId: query.companyId || undefined,
    enabled: parseEnabledFilter(query.enabled),
    limit: parseLimit(query.limit),
    offset: parseOffset(query.offset),
  };

  return {
    entries: listRegistryEntries(filters),
    total: countRegistryEntriesFiltered(filters),
    limit: filters.limit,
    offset: filters.offset,
  };
}

export function createEntryFromBody(body = {}) {
  const companyId = body.companyId;
  if (!companyId) throw new Error('companyId is required');

  const company = getCompanyById(companyId);
  if (!company) throw new Error('Company not found');

  const source = assertSupportedSource(body.source);
  const connectionPayload = body.connectionPayload || {};
  let boardToken = String(body.boardToken || '').trim();
  let careersUrl = String(body.careersUrl || '').trim();

  if (source === 'workday') {
    const validation = validateWorkdayPayload(connectionPayload);
    if (!validation.valid) throw new Error(validation.error);
    if (!boardToken) {
      boardToken = buildWorkdayBoardToken(connectionPayload.tenant, connectionPayload.site);
    }
    if (!careersUrl) {
      careersUrl = buildWorkdayCareersUrlFromPayload(connectionPayload);
    }
  } else {
    if (!boardToken) throw new Error('boardToken is required');
    if (!careersUrl) careersUrl = buildCareersUrl(source, boardToken);
  }

  const entry = createRegistryEntry({
    companyId,
    source,
    careersUrl,
    boardToken,
    connectionPayload,
    priority: body.priority ?? 50,
    enabled: body.enabled !== false,
  });

  return { entry, created: true };
}

export function patchRegistryEntry(id, body = {}) {
  const existing = getRegistryEntryById(id);
  if (!existing) return null;

  const patch = {};
  if (body.careersUrl !== undefined) patch.careersUrl = body.careersUrl;
  if (body.boardToken !== undefined) patch.boardToken = body.boardToken;
  if (body.connectionPayload !== undefined) patch.connectionPayload = body.connectionPayload;
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.enabled !== undefined) patch.enabled = body.enabled;

  if (Object.keys(patch).length === 0) {
    throw new Error('No valid fields to update');
  }

  return updateRegistryEntry(id, patch);
}

export function toggleRegistryEntryById(id, body = {}) {
  const enabled =
    body.enabled !== undefined ? parseEnabledFilter(body.enabled) : undefined;
  return toggleRegistryEntry(id, enabled);
}

export function getStatsSummaryResponse() {
  return getRegistryStatsSummary();
}

export { SUPPORTED_SOURCES };
