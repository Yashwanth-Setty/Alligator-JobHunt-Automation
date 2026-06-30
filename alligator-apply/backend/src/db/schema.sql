-- Alligator Apply v1 schema (SQLite)

CREATE TABLE IF NOT EXISTS resume_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER DEFAULT 0,
  uploaded_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  extracted_text TEXT DEFAULT '',
  parsed_profile TEXT DEFAULT '{}',
  parse_status TEXT DEFAULT 'pending',
  parse_error TEXT DEFAULT '',
  parsed_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  source TEXT,
  score INTEGER DEFAULT 0,
  location TEXT,
  remote_type TEXT,
  employment_type TEXT,
  experience_level TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  date_posted TEXT,
  visa_fit TEXT DEFAULT 'unknown',
  auto_apply_eligible INTEGER DEFAULT 0,
  pipeline_status TEXT DEFAULT 'found',
  data_source TEXT DEFAULT 'live',
  description TEXT DEFAULT '',
  quality_checks TEXT,
  is_hidden INTEGER DEFAULT 0,
  is_saved INTEGER DEFAULT 0,
  scan_run_id TEXT,
  normalized_location TEXT,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  pipeline_status TEXT DEFAULT 'found',
  interview_stage TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  date_applied TEXT,
  next_followup_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS application_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_apply_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  fields_filled TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'idle',
  progress INTEGER DEFAULT 0,
  message TEXT,
  jobs_found INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_score ON jobs(score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_manual_review_open ON manual_review_items(status);
