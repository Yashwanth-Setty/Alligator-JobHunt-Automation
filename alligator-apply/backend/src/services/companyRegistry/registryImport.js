/**
 * Import legacy source_targets into the Company Registry (Phase 1B).
 */

import { getDb } from '../../db/database.js';
import { listSourceTargets, seedSourcesIfEmpty } from '../sourceStore.js';
import {
  findOrCreateCompany,
  resolveNormalizedCompanyName,
  upsertRegistryEntry,
} from './registryStore.js';

export const SUPPORTED_IMPORT_SOURCES = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
];

export const CAREERS_URL_TEMPLATES = {
  greenhouse: (token) => `https://boards.greenhouse.io/${token}`,
  lever: (token) => `https://jobs.lever.co/${token}`,
  ashby: (token) => `https://jobs.ashbyhq.com/${token}`,
  smartrecruiters: (token) => `https://careers.smartrecruiters.com/${token}`,
};

/**
 * Derive a display company name from a target slug.
 * Preserves mixed-case slugs (e.g. Ashby, SmartRecruiters).
 */
export function slugToCompanyName(slug) {
  const value = String(slug || '').trim();
  if (!value) return '';
  if (/[A-Z]/.test(value)) return value;
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function buildCareersUrl(source, boardToken) {
  const template = CAREERS_URL_TEMPLATES[source];
  if (!template) return '';
  return template(boardToken);
}

function listImportSourceTargets() {
  seedSourcesIfEmpty();
  return listSourceTargets().filter((row) => SUPPORTED_IMPORT_SOURCES.includes(row.source));
}

/**
 * Import all supported rows from source_targets into company_registry_entries.
 * Idempotent: reuses companies by normalized_name and upserts entries by (company, source, token).
 *
 * @returns {{ imported: number, updated: number, skipped: number, companiesCreated: number, errors: object[] }}
 */
export function importFromSourceTargets() {
  const targets = listImportSourceTargets();
  const result = {
    imported: 0,
    updated: 0,
    skipped: 0,
    companiesCreated: 0,
    errors: [],
  };

  for (const target of targets) {
    const source = target.source;
    const boardToken = String(target.target_slug || '').trim();

    if (!SUPPORTED_IMPORT_SOURCES.includes(source)) {
      result.skipped += 1;
      continue;
    }
    if (!boardToken) {
      result.skipped += 1;
      result.errors.push({ source, slug: target.target_slug, error: 'Empty target_slug' });
      continue;
    }

    try {
      const companyName = slugToCompanyName(boardToken);
      const { company, created } = findOrCreateCompany({ name: companyName });
      if (created) result.companiesCreated += 1;

      const { action } = upsertRegistryEntry({
        companyId: company.id,
        source,
        boardToken,
        careersUrl: buildCareersUrl(source, boardToken),
        connectionPayload: {},
        priority: 50,
        enabled: Boolean(target.enabled),
      });

      if (action === 'created') result.imported += 1;
      else result.updated += 1;
    } catch (err) {
      result.skipped += 1;
      result.errors.push({
        source,
        slug: boardToken,
        error: err.message || String(err),
      });
    }
  }

  return result;
}

export function countSourceTargetsForImport() {
  return listImportSourceTargets().length;
}

export function getRegistryEntryBySourceToken(source, boardToken) {
  const normalized = resolveNormalizedCompanyName(slugToCompanyName(boardToken));
  const row = getDb()
    .prepare(
      `SELECT e.id
       FROM company_registry_entries e
       JOIN companies c ON c.id = e.company_id
       WHERE e.source = ? AND e.board_token = ? AND c.normalized_name = ?`
    )
    .get(source, boardToken, normalized);
  return row?.id || null;
}
