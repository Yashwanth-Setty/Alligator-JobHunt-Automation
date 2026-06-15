"""Dashboard database schema — ResumeProfile, Application, history, auto-apply, settings."""
import os
import sqlite3
from datetime import datetime

from utils.apply_db import DB_PATH, get_connection

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

PIPELINE_STATUSES = [
    "found",
    "matched",
    "ready_to_apply",
    "auto_applied",
    "manual_pending",
    "applied",
    "waiting",
    "recruiter_screen",
    "hr_round",
    "technical_interview",
    "final_interview",
    "offer",
    "hired",
    "rejected",
    "failed",
    "skipped",
]

INTERVIEW_STAGES = [
    "",
    "recruiter_screen",
    "hr_round",
    "technical_interview",
    "final_interview",
    "offer",
]

MANUAL_REVIEW_REASONS = [
    "captcha",
    "complex_workday_form",
    "visa_question",
    "missing_required_data",
    "file_upload_issue",
    "unknown_field",
    "salary_required",
    "eeo_required",
    "auto_apply_failed",
]

_LEGACY_STATUS_MAP = {
    "": "found",
    "new": "found",
    "need_to_apply": "matched",
    "ready_to_apply": "ready_to_apply",
    "applied": "applied",
    "recruiter_contacted": "recruiter_screen",
    "interviewing": "technical_interview",
    "rejected": "rejected",
    "skipped": "skipped",
    "needs_review": "manual_pending",
}


def _now() -> str:
    return datetime.now().isoformat()


def init_dashboard_schema(conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or get_connection()
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS resume_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_type TEXT,
                file_size INTEGER DEFAULT 0,
                uploaded_at TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                parsed_at TEXT,
                skills_count INTEGER DEFAULT 0,
                pages_count INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS applications (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL UNIQUE,
                pipeline_status TEXT DEFAULT 'found',
                interview_stage TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                date_applied TEXT,
                next_followup_date TEXT,
                auto_apply_eligible INTEGER DEFAULT 0,
                visa_fit TEXT DEFAULT 'unknown',
                employment_type TEXT,
                remote_type TEXT,
                experience_level TEXT,
                salary_min INTEGER,
                salary_max INTEGER,
                date_posted TEXT,
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
                application_id TEXT,
                status TEXT NOT NULL,
                reason TEXT,
                fields_filled TEXT,
                paused_at TEXT,
                completed_at TEXT,
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

            CREATE INDEX IF NOT EXISTS idx_applications_job ON applications(job_id);
            CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(pipeline_status);
            CREATE INDEX IF NOT EXISTS idx_manual_review_open ON manual_review_items(status);
            CREATE INDEX IF NOT EXISTS idx_auto_apply_job ON auto_apply_attempts(job_id);
            """
        )
        _migrate_job_columns(conn)
        conn.commit()
    finally:
        if own:
            conn.close()


def _migrate_job_columns(conn: sqlite3.Connection) -> None:
    cols = [
        ("employment_type", "TEXT"),
        ("remote_type", "TEXT"),
        ("experience_level", "TEXT"),
        ("salary_min", "INTEGER"),
        ("salary_max", "INTEGER"),
        ("date_posted", "TEXT"),
        ("visa_fit", "TEXT"),
        ("auto_apply_eligible", "INTEGER DEFAULT 0"),
        ("pipeline_status", "TEXT"),
        ("interview_stage", "TEXT"),
        ("next_followup_date", "TEXT"),
    ]
    for name, typedef in cols:
        try:
            conn.execute(f"ALTER TABLE jobs ADD COLUMN {name} {typedef}")
        except sqlite3.OperationalError:
            pass


def sync_applications_from_jobs(conn: sqlite3.Connection | None = None) -> int:
    """Ensure every job has an application row; backfill pipeline_status from apply_status."""
    own = conn is None
    conn = conn or get_connection()
    init_dashboard_schema(conn)
    rows = conn.execute(
        "SELECT id, apply_status, score, applied_at, notes, url FROM jobs "
        "WHERE duplicate_of IS NULL OR duplicate_of=''"
    ).fetchall()
    created = 0
    now = _now()
    for jid, apply_status, score, applied_at, notes, url in rows:
        existing = conn.execute("SELECT id FROM applications WHERE job_id=?", (jid,)).fetchone()
        legacy = apply_status or ""
        pipeline = _LEGACY_STATUS_MAP.get(legacy, legacy if legacy in PIPELINE_STATUSES else "found")
        if score and int(score or 0) >= 50 and pipeline in ("found", "matched", ""):
            pipeline = "matched"
        eligible = 1 if _infer_auto_eligible(score, url) else 0
        visa_fit = "cpt_friendly" if eligible else "review"
        if existing:
            conn.execute(
                "UPDATE applications SET auto_apply_eligible=?, visa_fit=?, updated_at=? "
                "WHERE job_id=? AND pipeline_status IN ('found','matched','')",
                (eligible, visa_fit, now, jid),
            )
            continue
        app_id = f"app_{jid}"
        conn.execute(
            "INSERT INTO applications "
            "(id, job_id, pipeline_status, notes, date_applied, auto_apply_eligible, "
            "visa_fit, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (app_id, jid, pipeline, notes or "", applied_at or "", eligible, visa_fit, now, now),
        )
        created += 1
    conn.commit()
    if own:
        conn.close()
    return created


def _infer_auto_eligible(score: int | None, url: str | None) -> bool:
    if not url or not str(url).startswith("http"):
        return False
    s = int(score or 0)
    if s < 65:
        return False
    low = str(url).lower()
    if "workday" in low and "myworkdayjobs" in low:
        return False
    return True


def map_pipeline_to_apply_status(pipeline_status: str) -> str:
    reverse = {
        "found": "need_to_apply",
        "matched": "need_to_apply",
        "ready_to_apply": "ready_to_apply",
        "auto_applied": "applied",
        "manual_pending": "needs_review",
        "applied": "applied",
        "waiting": "applied",
        "recruiter_screen": "recruiter_contacted",
        "hr_round": "interviewing",
        "technical_interview": "interviewing",
        "final_interview": "interviewing",
        "offer": "interviewing",
        "hired": "applied",
        "rejected": "rejected",
        "failed": "needs_review",
        "skipped": "skipped",
    }
    return reverse.get(pipeline_status, pipeline_status)


__all__ = [
    "DB_PATH",
    "PIPELINE_STATUSES",
    "INTERVIEW_STAGES",
    "MANUAL_REVIEW_REASONS",
    "init_dashboard_schema",
    "sync_applications_from_jobs",
    "map_pipeline_to_apply_status",
]
