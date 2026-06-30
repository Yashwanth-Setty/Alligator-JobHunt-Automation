import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'alligator.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const MIGRATIONS_PATH = path.join(__dirname, 'migrations.sql');

let db;

function runMigrations(database) {
  if (fs.existsSync(MIGRATIONS_PATH)) {
    const migrations = fs.readFileSync(MIGRATIONS_PATH, 'utf8');
    database.exec(migrations);
  }

  const scanCols = database.prepare('PRAGMA table_info(scan_runs)').all().map((c) => c.name);
  const addCol = (name, def) => {
    if (!scanCols.includes(name)) {
      database.exec(`ALTER TABLE scan_runs ADD COLUMN ${name} ${def}`);
    }
  };
  addCol('jobs_matched', 'INTEGER DEFAULT 0');
  addCol('eligible_count', 'INTEGER DEFAULT 0');
  addCol('source_summary', 'TEXT');
  addCol('scan_report', 'TEXT');
  addCol('failed_sources', 'TEXT');
  addCol('search_filters', 'TEXT');

  const appCols = database.prepare('PRAGMA table_info(applications)').all().map((c) => c.name);
  const addAppCol = (name, def) => {
    if (!appCols.includes(name)) {
      database.exec(`ALTER TABLE applications ADD COLUMN ${name} ${def}`);
    }
  };
  addAppCol('company', 'TEXT');
  addAppCol('title', 'TEXT');
  addAppCol('source', 'TEXT');
  addAppCol('recruiter_name', 'TEXT');
  addAppCol('recruiter_email', 'TEXT');

  const jobCols = database.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  if (!jobCols.includes('data_source')) {
    database.exec("ALTER TABLE jobs ADD COLUMN data_source TEXT DEFAULT 'live'");
    database.exec("UPDATE jobs SET data_source = 'mock' WHERE id LIKE 'mock-%'");
  }
  const ensureJobCol = (name, def) => {
    const cols = database.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
    if (!cols.includes(name)) database.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${def}`);
  };
  ensureJobCol('description', "TEXT DEFAULT ''");
  ensureJobCol('quality_checks', 'TEXT');
  ensureJobCol('is_hidden', 'INTEGER DEFAULT 0');
  ensureJobCol('is_saved', 'INTEGER DEFAULT 0');
  ensureJobCol('scan_run_id', 'TEXT');
  ensureJobCol('normalized_location', 'TEXT');

  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_jobs_normalized_location'").get()) {
    database.exec('CREATE INDEX idx_jobs_normalized_location ON jobs(normalized_location)');
  }
  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_applications_status'").get()) {
    database.exec('CREATE INDEX idx_applications_status ON applications(pipeline_status)');
  }
  if (!database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_applications_company'").get()) {
    database.exec('CREATE INDEX idx_applications_company ON applications(company)');
  }

  const ensureResumeCol = (name, def) => {
    const cols = database.prepare('PRAGMA table_info(resume_profiles)').all().map((c) => c.name);
    if (!cols.includes(name)) database.exec(`ALTER TABLE resume_profiles ADD COLUMN ${name} ${def}`);
  };
  ensureResumeCol('extracted_text', "TEXT DEFAULT ''");
  ensureResumeCol('parsed_profile', "TEXT DEFAULT '{}'");
  ensureResumeCol('parse_status', "TEXT DEFAULT 'pending'");
  ensureResumeCol('parse_error', "TEXT DEFAULT ''");
  ensureResumeCol('parsed_at', 'TEXT');

  const ensureRegistryCol = (name, def) => {
    const cols = database.prepare('PRAGMA table_info(company_registry_entries)').all().map((c) => c.name);
    if (cols.length && !cols.includes(name)) {
      database.exec(`ALTER TABLE company_registry_entries ADD COLUMN ${name} ${def}`);
    }
  };
  ensureRegistryCol('consecutive_failures', 'INTEGER DEFAULT 0');

  seedCompanyRegistryFoundation(database);
}

function seedCompanyRegistryFoundation(database) {
  const insertTag = database.prepare(
    'INSERT OR IGNORE INTO company_tags (id, slug, label) VALUES (?, ?, ?)'
  );
  const tags = [
    ['ai', 'ai', 'AI'],
    ['fintech', 'fintech', 'FinTech'],
    ['healthcare', 'healthcare', 'Healthcare'],
    ['enterprise', 'enterprise', 'Enterprise'],
    ['startup', 'startup', 'Startup'],
    ['consulting', 'consulting', 'Consulting'],
    ['faang', 'faang', 'FAANG'],
    ['remote_first', 'remote_first', 'Remote First'],
  ];
  for (const row of tags) {
    insertTag.run(...row);
  }
}

export function getDb() {
  if (!db) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schema);
    runMigrations(db);
  }
  return db;
}

export function now() {
  return new Date().toISOString();
}

export { DB_PATH, DATA_DIR };
