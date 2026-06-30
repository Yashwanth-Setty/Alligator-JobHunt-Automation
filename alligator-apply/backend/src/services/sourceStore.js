import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, now } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TARGETS_PATH = path.join(__dirname, '../../data/source_targets.json');

export const SOURCE_META = {
  greenhouse: { label: 'Greenhouse', targetLabel: 'Board tokens' },
  lever: { label: 'Lever', targetLabel: 'Company slugs' },
  ashby: { label: 'Ashby', targetLabel: 'Board names' },
  smartrecruiters: { label: 'SmartRecruiters', targetLabel: 'Company identifiers' },
  workday: { label: 'Workday', targetLabel: 'Registry entries (CXS)' },
};

const ALL_SOURCES = Object.keys(SOURCE_META);

function loadDefaultTargets() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_TARGETS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function seedSourcesIfEmpty() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) AS c FROM job_sources').get().c;
  if (count > 0) {
    syncJobSourcesFromEnv();
    return;
  }

  const ts = now();
  const insert = db.prepare(
    'INSERT INTO job_sources (source, label, enabled, updated_at) VALUES (?, ?, ?, ?)'
  );
  const defaults = loadDefaultTargets();
  const envSources = parseEnvJobSources();

  for (const source of ALL_SOURCES) {
    const enabled = envSources.includes(source) ? 1 : 0;
    insert.run(source, SOURCE_META[source].label, enabled, ts);
  }

  syncJobSourcesFromEnv();

  const insertTarget = db.prepare(
    `INSERT INTO source_targets (source, target_slug, enabled, created_at, updated_at)
     VALUES (?, ?, 1, ?, ?)`
  );
  for (const [source, slugs] of Object.entries(defaults)) {
    for (const slug of slugs || []) {
      insertTarget.run(source, slug, ts, ts);
    }
  }
}

export function parseEnvJobSources() {
  return (process.env.JOB_SOURCES || 'greenhouse,lever,ashby,smartrecruiters')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Insert JOB_SOURCES entries missing from job_sources (e.g. workday after env update). */
export function syncJobSourcesFromEnv() {
  const db = getDb();
  const envSources = parseEnvJobSources();
  if (envSources.length === 0) return;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO job_sources (source, label, enabled, updated_at)
     VALUES (?, ?, 1, ?)`
  );
  const ts = now();

  for (const source of envSources) {
    const meta = SOURCE_META[source] || {
      label: source.charAt(0).toUpperCase() + source.slice(1),
    };
    insert.run(source, meta.label, ts);
  }
}

export function getEnabledSourceNames() {
  seedSourcesIfEmpty();
  return getDb()
    .prepare('SELECT source FROM job_sources WHERE enabled = 1 ORDER BY source')
    .all()
    .map((r) => r.source);
}

export function getEnabledTargetsForSource(sourceName) {
  seedSourcesIfEmpty();
  const rows = getDb()
    .prepare(
      'SELECT target_slug FROM source_targets WHERE source = ? AND enabled = 1 ORDER BY target_slug'
    )
    .all(sourceName);
  if (rows.length > 0) return rows.map((r) => r.target_slug);
  const defaults = loadDefaultTargets();
  return defaults[sourceName] || [];
}

export function listJobSources() {
  seedSourcesIfEmpty();
  return getDb()
    .prepare('SELECT source, label, enabled, updated_at FROM job_sources ORDER BY source')
    .all();
}

export function listSourceTargets() {
  seedSourcesIfEmpty();
  return getDb()
    .prepare(
      `SELECT id, source, target_slug, enabled, created_at, updated_at
       FROM source_targets ORDER BY source, target_slug`
    )
    .all();
}

export function setSourceEnabled(sourceName, enabled) {
  seedSourcesIfEmpty();
  getDb()
    .prepare('UPDATE job_sources SET enabled = ?, updated_at = ? WHERE source = ?')
    .run(enabled ? 1 : 0, now(), sourceName);
}

export function addTarget(source, slug) {
  seedSourcesIfEmpty();
  const trimmed = String(slug || '').trim();
  if (!trimmed) throw new Error('Target slug is required');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO source_targets (source, target_slug, enabled, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(source, target_slug) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at`
    )
    .run(source, trimmed, ts, ts);
}

export function removeTarget(id) {
  getDb().prepare('DELETE FROM source_targets WHERE id = ?').run(id);
}

export function replaceTargets(source, slugs) {
  seedSourcesIfEmpty();
  const db = getDb();
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM source_targets WHERE source = ?').run(source);
    const insert = db.prepare(
      `INSERT INTO source_targets (source, target_slug, enabled, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`
    );
    for (const slug of slugs) {
      const trimmed = String(slug || '').trim();
      if (trimmed) insert.run(source, trimmed, ts, ts);
    }
  });
  tx();
}

export function getLastCompletedScanRow() {
  return getDb()
    .prepare(
      `SELECT id, status, jobs_found, jobs_matched, eligible_count, started_at, finished_at,
              source_summary, scan_report, failed_sources
       FROM scan_runs WHERE status IN ('completed', 'failed', 'cancelled')
       ORDER BY finished_at DESC LIMIT 1`
    )
    .get();
}

export function safeJson(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
