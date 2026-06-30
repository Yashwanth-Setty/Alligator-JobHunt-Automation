-- Phase 3 migrations (idempotent)

CREATE TABLE IF NOT EXISTS job_sources (
  source TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  target_slug TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, target_slug)
);

CREATE INDEX IF NOT EXISTS idx_source_targets_source ON source_targets(source);

-- Phase 8A: Company Registry (idempotent)
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  domain TEXT DEFAULT '',
  industry TEXT DEFAULT '',
  visa_sponsor_hint TEXT DEFAULT 'unknown',
  remote_policy TEXT DEFAULT 'unknown',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_normalized_name ON companies(normalized_name);
CREATE INDEX IF NOT EXISTS idx_companies_industry ON companies(industry);

CREATE TABLE IF NOT EXISTS company_tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_tag_links (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES company_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (company_id, tag_id)
);

CREATE TABLE IF NOT EXISTS company_registry_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  careers_url TEXT DEFAULT '',
  board_token TEXT DEFAULT '',
  connection_payload TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 50,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scan_at TEXT,
  last_successful_scan_at TEXT,
  last_scan_status TEXT DEFAULT 'never',
  jobs_fetched_last INTEGER DEFAULT 0,
  jobs_persisted_last INTEGER DEFAULT 0,
  last_error TEXT DEFAULT '',
  consecutive_failures INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, source, board_token)
);

CREATE INDEX IF NOT EXISTS idx_registry_source_enabled
  ON company_registry_entries(source, enabled, priority DESC);
CREATE INDEX IF NOT EXISTS idx_registry_company ON company_registry_entries(company_id);

-- Phase 4: Applications CRM columns
-- Applied via database.js runMigrations ALTER TABLE guards
