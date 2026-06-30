/**
 * Phase 3 — load and validate registry seed datasets (idempotent upsert).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildWorkdayBoardToken,
  buildWorkdayCareersUrlFromPayload,
  validateWorkdayPayload,
} from '../../sources/workdayCxs.js';
import {
  REMOTE_POLICIES,
  ensureCompanyWithMetadata,
  upsertRegistryEntry,
} from './registryStore.js';
import { buildCareersUrl } from './registryImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REGISTRY_DATA_DIR = path.join(__dirname, '../../../data/registry');

export const SEED_SOURCES = ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday'];
export const TOKEN_SOURCES = ['greenhouse', 'lever', 'ashby', 'smartrecruiters'];

const TAG_SLUGS = new Set([
  'ai',
  'fintech',
  'healthcare',
  'enterprise',
  'startup',
  'consulting',
  'faang',
  'remote_first',
]);

/**
 * @typedef {object} RegistrySeedRow
 * @property {string} name
 * @property {string} boardToken
 * @property {string} [domain]
 * @property {string} [industry]
 * @property {string[]} [tags]
 * @property {string} [remotePolicy]
 * @property {number} [priority]
 * @property {boolean} [enabled]
 * @property {object} [connectionPayload]
 * @property {string} [careersUrl]
 */

export function loadSeedFile(source) {
  const filePath = path.join(REGISTRY_DATA_DIR, `${source}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Seed file not found: ${filePath}`);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`${source}.json must be a JSON array`);
  }
  return raw;
}

export function loadAllSeedDatasets() {
  const datasets = {};
  for (const source of SEED_SOURCES) {
    datasets[source] = loadSeedFile(source);
  }
  return datasets;
}

function normalizeRemotePolicy(value) {
  const policy = String(value || 'unknown').trim();
  return REMOTE_POLICIES.includes(policy) ? policy : 'unknown';
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter((t) => TAG_SLUGS.has(t)))];
}

/**
 * Validate one seed row for a given source.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSeedRow(row, source, index) {
  const errors = [];
  const label = `${source}[${index}]`;

  if (!row || typeof row !== 'object') {
    return { valid: false, errors: [`${label}: row must be an object`] };
  }
  if (!String(row.name || '').trim()) errors.push(`${label}: name is required`);

  if (source === 'workday') {
    const payload = row.connectionPayload || row.payload || {};
    const check = validateWorkdayPayload(payload);
    if (!check.valid) errors.push(`${label}: ${check.error}`);
  } else if (!String(row.boardToken || '').trim()) {
    errors.push(`${label}: boardToken is required`);
  } else if (/\s/.test(String(row.boardToken))) {
    errors.push(`${label}: boardToken must not contain whitespace`);
  }

  if (row.remotePolicy && !REMOTE_POLICIES.includes(row.remotePolicy)) {
    errors.push(`${label}: invalid remotePolicy "${row.remotePolicy}"`);
  }

  for (const tag of row.tags || []) {
    if (!TAG_SLUGS.has(String(tag).toLowerCase())) {
      errors.push(`${label}: unknown tag "${tag}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an entire seed dataset for a source.
 */
export function validateSeedDataset(rows, source) {
  const errors = [];
  const tokens = new Set();

  rows.forEach((row, index) => {
    const result = validateSeedRow(row, source, index);
    errors.push(...result.errors);

    const token =
      source === 'workday'
        ? buildWorkdayBoardToken(
            row.connectionPayload?.tenant || row.payload?.tenant,
            row.connectionPayload?.site || row.payload?.site
          )
        : String(row.boardToken || '').trim();

    if (token) {
      const key = `${source}::${token.toLowerCase()}`;
      if (tokens.has(key)) errors.push(`${source}[${index}]: duplicate boardToken "${token}"`);
      tokens.add(key);
    }
  });

  return { valid: errors.length === 0, errors, count: rows.length };
}

export function validateAllSeedDatasets(datasets = null) {
  const data = datasets || loadAllSeedDatasets();
  const bySource = {};
  const allErrors = [];
  let total = 0;

  for (const source of SEED_SOURCES) {
    const rows = data[source] || [];
    const result = validateSeedDataset(rows, source);
    bySource[source] = { count: result.count, valid: result.valid, errors: result.errors };
    allErrors.push(...result.errors);
    total += result.count;
  }

  return {
    valid: allErrors.length === 0,
    total,
    bySource,
    errors: allErrors,
  };
}

function resolveWorkdayRow(row) {
  const payload = row.connectionPayload || row.payload || {};
  const boardToken = row.boardToken?.trim() || buildWorkdayBoardToken(payload.tenant, payload.site);
  const careersUrl = row.careersUrl?.trim() || buildWorkdayCareersUrlFromPayload(payload);
  return { boardToken, careersUrl, connectionPayload: payload };
}

function resolveTokenRow(row, source) {
  const boardToken = String(row.boardToken || '').trim();
  const careersUrl = row.careersUrl?.trim() || buildCareersUrl(source, boardToken);
  return { boardToken, careersUrl, connectionPayload: {} };
}

/**
 * Upsert all rows for one source. Idempotent.
 */
export function seedRegistrySource(source, rows, { dryRun = false } = {}) {
  const validation = validateSeedDataset(rows, source);
  if (!validation.valid) {
    throw new Error(`Invalid ${source} seed:\n${validation.errors.join('\n')}`);
  }

  const stats = {
    source,
    companiesCreated: 0,
    entriesCreated: 0,
    entriesUpdated: 0,
    skipped: 0,
    errors: [],
  };

  for (const row of rows) {
    try {
      const name = String(row.name).trim();
      const { boardToken, careersUrl, connectionPayload } =
        source === 'workday' ? resolveWorkdayRow(row) : resolveTokenRow(row, source);

      if (dryRun) continue;

      const { company, created: companyCreated } = ensureCompanyWithMetadata({
        name,
        domain: row.domain || '',
        industry: row.industry || '',
        remotePolicy: normalizeRemotePolicy(row.remotePolicy),
        tags: normalizeTags(row.tags),
      });
      if (companyCreated) stats.companiesCreated += 1;

      const { action } = upsertRegistryEntry({
        companyId: company.id,
        source,
        boardToken,
        careersUrl,
        connectionPayload,
        priority: Number(row.priority) || 50,
        enabled: row.enabled !== false,
      });

      if (action === 'created') stats.entriesCreated += 1;
      else stats.entriesUpdated += 1;
    } catch (err) {
      stats.skipped += 1;
      stats.errors.push({ name: row.name, error: err.message || String(err) });
    }
  }

  return stats;
}

/**
 * Seed all registry datasets. Idempotent — safe to re-run.
 */
export function seedAllRegistryDatasets({ dryRun = false, sources = SEED_SOURCES } = {}) {
  const datasets = loadAllSeedDatasets();
  const validation = validateAllSeedDatasets(datasets);
  if (!validation.valid) {
    throw new Error(`Registry seed validation failed:\n${validation.errors.slice(0, 20).join('\n')}`);
  }

  const results = [];
  for (const source of sources) {
    results.push(seedRegistrySource(source, datasets[source], { dryRun }));
  }

  const summary = {
    dryRun,
    totalSeedRows: validation.total,
    companiesCreated: results.reduce((n, r) => n + r.companiesCreated, 0),
    entriesCreated: results.reduce((n, r) => n + r.entriesCreated, 0),
    entriesUpdated: results.reduce((n, r) => n + r.entriesUpdated, 0),
    skipped: results.reduce((n, r) => n + r.skipped, 0),
    errors: results.flatMap((r) => r.errors.map((e) => ({ ...e, source: r.source }))),
    bySource: Object.fromEntries(results.map((r) => [r.source, r])),
  };

  return summary;
}
