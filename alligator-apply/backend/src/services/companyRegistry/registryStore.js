/**
 * Company Registry — Phase 1A data access (no scan integration yet).
 */

import { v4 as uuidv4 } from 'uuid';
import { getDb, now } from '../../db/database.js';
import { normalizeCompany } from '../../sources/normalize.js';

export const DEFAULT_COMPANY_TAGS = [
  { slug: 'ai', label: 'AI' },
  { slug: 'fintech', label: 'FinTech' },
  { slug: 'healthcare', label: 'Healthcare' },
  { slug: 'enterprise', label: 'Enterprise' },
  { slug: 'startup', label: 'Startup' },
  { slug: 'consulting', label: 'Consulting' },
  { slug: 'faang', label: 'FAANG' },
  { slug: 'remote_first', label: 'Remote First' },
];

export const VISA_SPONSOR_HINTS = ['unknown', 'positive', 'negative', 'not_required'];
export const REMOTE_POLICIES = ['unknown', 'remote_first', 'hybrid', 'onsite'];
export const SCAN_STATUSES = ['never', 'success', 'failed', 'skipped', 'cached'];

/** Prefix for registry rows created by automated tests — excluded from scans. */
export const TEST_REGISTRY_PREFIX = '__test__';

/** Legacy smoke-test slug from early Phase 1A runs (removed on cleanup). */
export const LEGACY_SMOKE_BOARD_TOKEN = 'registry-smoke-co';

/** SQL fragment excluding test registry rows from scan planning. */
export const TEST_REGISTRY_SQL_EXCLUDE = `
  AND e.board_token NOT LIKE '${TEST_REGISTRY_PREFIX}%'
  AND c.normalized_name NOT LIKE '${TEST_REGISTRY_PREFIX}%'
`;

function parsePayload(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function normalizeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    normalizedName: row.normalized_name,
    domain: row.domain || '',
    industry: row.industry || '',
    visaSponsorHint: row.visa_sponsor_hint || 'unknown',
    remotePolicy: row.remote_policy || 'unknown',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeEntryRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    source: row.source,
    careersUrl: row.careers_url || '',
    boardToken: row.board_token || '',
    connectionPayload: parsePayload(row.connection_payload),
    priority: row.priority ?? 50,
    enabled: Boolean(row.enabled),
    lastScanAt: row.last_scan_at || null,
    lastSuccessfulScanAt: row.last_successful_scan_at || null,
    lastScanStatus: row.last_scan_status || 'never',
    jobsFetchedLast: row.jobs_fetched_last ?? 0,
    jobsPersistedLast: row.jobs_persisted_last ?? 0,
    lastError: row.last_error || '',
    consecutiveFailures: row.consecutive_failures ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    companyName: row.company_name || null,
  };
}

export function seedCompanyRegistryTags() {
  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO company_tags (id, slug, label) VALUES (?, ?, ?)'
  );
  for (const tag of DEFAULT_COMPANY_TAGS) {
    insert.run(tag.slug, tag.slug, tag.label);
  }
}

export function listCompanyTags() {
  seedCompanyRegistryTags();
  return getDb()
    .prepare('SELECT id, slug, label FROM company_tags ORDER BY label')
    .all()
    .map((row) => ({ id: row.id, slug: row.slug, label: row.label }));
}

export function resolveNormalizedCompanyName(name) {
  const normalized = normalizeCompany(name);
  return normalized || String(name || '').toLowerCase().trim().replace(/\s+/g, '-');
}

function linkTags(companyId, tagSlugs = []) {
  if (!tagSlugs.length) return;
  const db = getDb();
  seedCompanyRegistryTags();
  const findTag = db.prepare('SELECT id FROM company_tags WHERE slug = ?');
  const link = db.prepare(
    'INSERT OR IGNORE INTO company_tag_links (company_id, tag_id) VALUES (?, ?)'
  );
  for (const slug of tagSlugs) {
    const tag = findTag.get(String(slug).toLowerCase().trim());
    if (tag) link.run(companyId, tag.id);
  }
}

export function getCompanyTags(companyId) {
  return getDb()
    .prepare(
      `SELECT t.slug, t.label
       FROM company_tag_links l
       JOIN company_tags t ON t.id = l.tag_id
       WHERE l.company_id = ?
       ORDER BY t.label`
    )
    .all(companyId)
    .map((row) => ({ slug: row.slug, label: row.label }));
}

export function findCompanyByNormalizedName(normalizedName) {
  const row = getDb()
    .prepare('SELECT * FROM companies WHERE normalized_name = ?')
    .get(normalizedName);
  if (!row) return null;
  return {
    ...normalizeRow(row),
    tags: getCompanyTags(row.id),
  };
}

export function findOrCreateCompany({ name, domain = '', industry = '' }) {
  const displayName = String(name || '').trim();
  if (!displayName) throw new Error('Company name is required');
  const normalizedName = resolveNormalizedCompanyName(displayName);
  const existing = findCompanyByNormalizedName(normalizedName);
  if (existing) {
    return { company: existing, created: false };
  }
  const company = createCompany({ name: displayName, domain, industry });
  return { company, created: true };
}

/**
 * Find or create a company and refresh metadata (idempotent registry seed).
 * Metadata is set on create only; re-seeds add tags without overwriting industry/remote policy.
 */
export function ensureCompanyWithMetadata({
  name,
  domain = '',
  industry = '',
  remotePolicy = 'unknown',
  tags = [],
}) {
  const { company, created } = findOrCreateCompany({ name, domain, industry });

  if (created) {
    const db = getDb();
    const ts = now();
    const policy = REMOTE_POLICIES.includes(remotePolicy) ? remotePolicy : 'unknown';
    db.prepare(
      `UPDATE companies SET
        domain = @domain,
        industry = @industry,
        remote_policy = @remotePolicy,
        updated_at = @ts
       WHERE id = @id`
    ).run({
      id: company.id,
      domain: String(domain || '').trim(),
      industry: String(industry || '').trim(),
      remotePolicy: policy,
      ts,
    });
  }

  linkTags(company.id, tags);

  return { company: getCompanyById(company.id), created };
}

export function upsertRegistryEntry({
  companyId,
  source,
  careersUrl = '',
  boardToken = '',
  connectionPayload = {},
  priority = 50,
  enabled = true,
}) {
  if (!companyId) throw new Error('companyId is required');
  if (!source?.trim()) throw new Error('source is required');

  const db = getDb();
  const src = source.trim().toLowerCase();
  const token = boardToken.trim();
  const ts = now();
  const payloadJson = JSON.stringify(connectionPayload || {});

  const existing = db
    .prepare(
      'SELECT id FROM company_registry_entries WHERE company_id = ? AND source = ? AND board_token = ?'
    )
    .get(companyId, src, token);

  if (existing) {
    db.prepare(
      `UPDATE company_registry_entries SET
        careers_url = ?, connection_payload = ?, priority = ?, enabled = ?, updated_at = ?
       WHERE id = ?`
    ).run(careersUrl.trim(), payloadJson, Number(priority) || 50, enabled ? 1 : 0, ts, existing.id);
    return { entry: getRegistryEntryById(existing.id), action: 'updated' };
  }

  const entry = createRegistryEntry({
    companyId,
    source: src,
    careersUrl,
    boardToken: token,
    connectionPayload,
    priority,
    enabled,
  });
  return { entry, action: 'created' };
}

export function createCompany({
  name,
  domain = '',
  industry = '',
  visaSponsorHint = 'unknown',
  remotePolicy = 'unknown',
  notes = '',
  tags = [],
}) {
  if (!name?.trim()) throw new Error('Company name is required');
  if (!VISA_SPONSOR_HINTS.includes(visaSponsorHint)) {
    throw new Error(`Invalid visaSponsorHint. Use: ${VISA_SPONSOR_HINTS.join(', ')}`);
  }
  if (!REMOTE_POLICIES.includes(remotePolicy)) {
    throw new Error(`Invalid remotePolicy. Use: ${REMOTE_POLICIES.join(', ')}`);
  }

  const db = getDb();
  const id = uuidv4();
  const ts = now();
  const normalizedName = resolveNormalizedCompanyName(name);

  db.prepare(
    `INSERT INTO companies (
      id, name, normalized_name, domain, industry,
      visa_sponsor_hint, remote_policy, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name.trim(),
    normalizedName,
    domain.trim(),
    industry.trim(),
    visaSponsorHint,
    remotePolicy,
    notes.trim(),
    ts,
    ts
  );

  linkTags(id, tags);

  return getCompanyById(id);
}

export function getCompanyById(id) {
  const row = getDb().prepare('SELECT * FROM companies WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...normalizeRow(row),
    tags: getCompanyTags(id),
  };
}

export function createRegistryEntry({
  companyId,
  source,
  careersUrl = '',
  boardToken = '',
  connectionPayload = {},
  priority = 50,
  enabled = true,
}) {
  if (!companyId) throw new Error('companyId is required');
  if (!source?.trim()) throw new Error('source is required');

  const company = getCompanyById(companyId);
  if (!company) throw new Error('Company not found');

  const db = getDb();
  const id = uuidv4();
  const ts = now();
  const payloadJson = JSON.stringify(connectionPayload || {});

  db.prepare(
    `INSERT INTO company_registry_entries (
      id, company_id, source, careers_url, board_token, connection_payload,
      priority, enabled, last_scan_status,
      jobs_fetched_last, jobs_persisted_last, last_error,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'never', 0, 0, '', ?, ?)`
  ).run(
    id,
    companyId,
    source.trim().toLowerCase(),
    careersUrl.trim(),
    boardToken.trim(),
    payloadJson,
    Number(priority) || 50,
    enabled ? 1 : 0,
    ts,
    ts
  );

  return getRegistryEntryById(id);
}

export function getRegistryEntryById(id) {
  const row = getDb()
    .prepare(
      `SELECT e.*, c.name AS company_name
       FROM company_registry_entries e
       JOIN companies c ON c.id = e.company_id
       WHERE e.id = ?`
    )
    .get(id);
  if (!row) return null;
  const entry = normalizeEntryRow(row);
  return {
    ...entry,
    company: getCompanyById(entry.companyId),
  };
}

export function listRegistryEntries(filters = {}) {
  const where = ['1=1'];
  const params = {};

  if (filters.source) {
    where.push('e.source = @source');
    params.source = String(filters.source).trim().toLowerCase();
  }
  if (filters.companyId) {
    where.push('e.company_id = @companyId');
    params.companyId = filters.companyId;
  }
  if (filters.enabled === true) {
    where.push('e.enabled = 1');
  }
  if (filters.enabled === false) {
    where.push('e.enabled = 0');
  }

  let sql = `
    SELECT e.*, c.name AS company_name
    FROM company_registry_entries e
    JOIN companies c ON c.id = e.company_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.priority DESC, c.name`;

  if (filters.limit != null) {
    sql += ' LIMIT @limit';
    params.limit = filters.limit;
  }
  if (filters.offset != null) {
    sql += ' OFFSET @offset';
    params.offset = filters.offset;
  }

  const rows = getDb().prepare(sql).all(params);
  return rows.map((row) => normalizeEntryRow(row));
}

export function countRegistryEntriesFiltered(filters = {}) {
  const where = ['1=1'];
  const params = {};

  if (filters.source) {
    where.push('e.source = @source');
    params.source = String(filters.source).trim().toLowerCase();
  }
  if (filters.companyId) {
    where.push('e.company_id = @companyId');
    params.companyId = filters.companyId;
  }
  if (filters.enabled === true) {
    where.push('e.enabled = 1');
  }
  if (filters.enabled === false) {
    where.push('e.enabled = 0');
  }

  return getDb()
    .prepare(
      `SELECT COUNT(*) AS c
       FROM company_registry_entries e
       WHERE ${where.join(' AND ')}`
    )
    .get(params)?.c ?? 0;
}

export function listCompanies(filters = {}) {
  const where = ['1=1'];
  const params = {};

  if (filters.search) {
    where.push(
      '(c.name LIKE @search OR c.domain LIKE @search OR c.normalized_name LIKE @search)'
    );
    params.search = `%${String(filters.search).trim()}%`;
  }
  if (filters.industry) {
    where.push('c.industry = @industry');
    params.industry = String(filters.industry).trim();
  }

  let joinTag = '';
  if (filters.tag) {
    joinTag = `
      JOIN company_tag_links ctl ON ctl.company_id = c.id
      JOIN company_tags ct ON ct.id = ctl.tag_id AND ct.slug = @tag`;
    params.tag = String(filters.tag).trim().toLowerCase();
  }

  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM company_registry_entries e WHERE e.company_id = c.id) AS entry_count
    FROM companies c
    ${joinTag}
    WHERE ${where.join(' AND ')}
    ORDER BY c.name`;

  if (filters.limit != null) {
    sql += ' LIMIT @limit';
    params.limit = filters.limit;
  }
  if (filters.offset != null) {
    sql += ' OFFSET @offset';
    params.offset = filters.offset;
  }

  const rows = getDb().prepare(sql).all(params);
  return rows.map((row) => ({
    ...normalizeRow(row),
    tags: getCompanyTags(row.id),
    entryCount: row.entry_count ?? 0,
  }));
}

export function countCompanies(filters = {}) {
  const where = ['1=1'];
  const params = {};

  if (filters.search) {
    where.push(
      '(c.name LIKE @search OR c.domain LIKE @search OR c.normalized_name LIKE @search)'
    );
    params.search = `%${String(filters.search).trim()}%`;
  }
  if (filters.industry) {
    where.push('c.industry = @industry');
    params.industry = String(filters.industry).trim();
  }

  let joinTag = '';
  if (filters.tag) {
    joinTag = `
      JOIN company_tag_links ctl ON ctl.company_id = c.id
      JOIN company_tags ct ON ct.id = ctl.tag_id AND ct.slug = @tag`;
    params.tag = String(filters.tag).trim().toLowerCase();
  }

  return getDb()
    .prepare(
      `SELECT COUNT(DISTINCT c.id) AS c
       FROM companies c
       ${joinTag}
       WHERE ${where.join(' AND ')}`
    )
    .get(params)?.c ?? 0;
}

export function updateRegistryEntry(id, patch = {}) {
  const existing = getRegistryEntryById(id);
  if (!existing) return null;

  const careersUrl =
    patch.careersUrl !== undefined ? String(patch.careersUrl).trim() : existing.careersUrl;
  const boardToken =
    patch.boardToken !== undefined ? String(patch.boardToken).trim() : existing.boardToken;
  const connectionPayload =
    patch.connectionPayload !== undefined ? patch.connectionPayload : existing.connectionPayload;
  const priority =
    patch.priority !== undefined ? Number(patch.priority) || 50 : existing.priority;
  const enabled = patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled;

  const db = getDb();
  const ts = now();
  const payloadJson = JSON.stringify(connectionPayload || {});

  db.prepare(
    `UPDATE company_registry_entries SET
      careers_url = ?, board_token = ?, connection_payload = ?,
      priority = ?, enabled = ?, updated_at = ?
     WHERE id = ?`
  ).run(careersUrl, boardToken, payloadJson, priority, enabled ? 1 : 0, ts, id);

  return getRegistryEntryById(id);
}

export function toggleRegistryEntry(id, enabled) {
  const existing = getRegistryEntryById(id);
  if (!existing) return null;
  const nextEnabled = enabled !== undefined ? Boolean(enabled) : !existing.enabled;
  return updateRegistryEntry(id, { enabled: nextEnabled });
}

export function getRegistryStatsSummary() {
  const db = getDb();
  seedCompanyRegistryTags();

  const totalCompanies = db.prepare('SELECT COUNT(*) AS c FROM companies').get().c;
  const totalEntries = db.prepare('SELECT COUNT(*) AS c FROM company_registry_entries').get().c;
  const enabledEntries =
    db.prepare('SELECT COUNT(*) AS c FROM company_registry_entries WHERE enabled = 1').get().c;

  const bySource = db
    .prepare(
      `SELECT source,
              COUNT(*) AS total,
              SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
       FROM company_registry_entries
       GROUP BY source
       ORDER BY source`
    )
    .all()
    .map((row) => ({
      source: row.source,
      total: row.total,
      enabled: row.enabled ?? 0,
    }));

  const scanStatusCounts = db
    .prepare(
      `SELECT last_scan_status AS status, COUNT(*) AS count
       FROM company_registry_entries
       GROUP BY last_scan_status`
    )
    .all()
    .reduce((acc, row) => {
      acc[row.status || 'never'] = row.count;
      return acc;
    }, {});

  return {
    totalCompanies,
    totalEntries,
    enabledEntries,
    disabledEntries: totalEntries - enabledEntries,
    tagCount: listCompanyTags().length,
    entriesBySource: bySource,
    scanStatusCounts,
  };
}

export function countRegistryEntriesForSource(source) {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS c
       FROM company_registry_entries e
       JOIN companies c ON c.id = e.company_id
       WHERE e.source = ? AND e.enabled = 1
       ${TEST_REGISTRY_SQL_EXCLUDE}`
    )
    .get(source)?.c ?? 0;
}

/**
 * Enabled registry entries for a source, scan-planner order.
 * @param {string} source
 * @param {{ limit?: number }} [options]
 */
export function listEnabledRegistryEntriesForSource(source, options = {}) {
  const db = getDb();
  const src = String(source || '').trim().toLowerCase();
  const cols = db.prepare('PRAGMA table_info(company_registry_entries)').all().map((c) => c.name);
  const hasFailures = cols.includes('consecutive_failures');

  let sql = `
    SELECT e.*, c.name AS company_name, c.industry, c.visa_sponsor_hint, c.remote_policy
    FROM company_registry_entries e
    JOIN companies c ON c.id = e.company_id
    WHERE e.source = @source AND e.enabled = 1
    ${TEST_REGISTRY_SQL_EXCLUDE}
    ORDER BY e.priority DESC,
             COALESCE(e.last_successful_scan_at, '1970-01-01T00:00:00.000Z') ASC`;
  if (hasFailures) {
    sql += `, COALESCE(e.consecutive_failures, 0) ASC`;
  }
  if (options.limit != null) {
    sql += ` LIMIT @limit`;
  }

  const params = { source: src };
  if (options.limit != null) params.limit = options.limit;

  return db.prepare(sql).all(params).map((row) => ({
    ...normalizeEntryRow(row),
    companyName: row.company_name || null,
    industry: row.industry || '',
    visaSponsorHint: row.visa_sponsor_hint || 'unknown',
    remotePolicy: row.remote_policy || 'unknown',
  }));
}

export function countRegistryEntries() {
  return getDb().prepare('SELECT COUNT(*) AS c FROM company_registry_entries').get().c;
}

export function isTestRegistryBoardToken(boardToken) {
  return String(boardToken || '').startsWith(TEST_REGISTRY_PREFIX);
}

/**
 * Remove test-only registry rows (and orphan test companies).
 * Safe to call before/after npm run test:registry.
 */
export function cleanupTestRegistryData() {
  const db = getDb();
  db.prepare(
    `DELETE FROM company_registry_entries
     WHERE board_token LIKE ? OR board_token = ?`
  ).run(`${TEST_REGISTRY_PREFIX}%`, LEGACY_SMOKE_BOARD_TOKEN);

  db.prepare(
    `DELETE FROM companies
     WHERE normalized_name LIKE ?
        OR normalized_name = ?
        OR name LIKE '[TEST] %'
        OR normalized_name = 'test registry smoke'
        OR name = ?`
  ).run(`${TEST_REGISTRY_PREFIX}%`, 'registry smoke', 'Registry Smoke Co');
}
