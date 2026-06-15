"""Application and dedupe migration helpers for jobs.db."""
import os
import sqlite3
from datetime import datetime

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(BASE, "jobs.db")

STATUS_NEED_TO_APPLY = "need_to_apply"
STATUS_APPLIED = "applied"
STATUS_SKIPPED = "skipped"
STATUS_NEW = "new"
STATUS_READY_TO_APPLY = "ready_to_apply"
STATUS_RECRUITER_CONTACTED = "recruiter_contacted"
STATUS_INTERVIEWING = "interviewing"
STATUS_REJECTED = "rejected"
STATUS_NEEDS_REVIEW = "needs_review"

APPLY_PENDING = STATUS_NEED_TO_APPLY
APPLY_APPLIED = STATUS_APPLIED
APPLY_SKIPPED = STATUS_SKIPPED
APPLY_PACKET_READY = "packet_ready"

ALL_STATUSES = [
    STATUS_NEED_TO_APPLY,
    STATUS_NEW,
    STATUS_READY_TO_APPLY,
    STATUS_APPLIED,
    STATUS_RECRUITER_CONTACTED,
    STATUS_INTERVIEWING,
    STATUS_REJECTED,
    STATUS_SKIPPED,
    STATUS_NEEDS_REVIEW,
]

__all__ = [
    "STATUS_NEED_TO_APPLY",
    "STATUS_APPLIED",
    "STATUS_SKIPPED",
    "STATUS_NEW",
    "STATUS_READY_TO_APPLY",
    "STATUS_RECRUITER_CONTACTED",
    "STATUS_INTERVIEWING",
    "STATUS_REJECTED",
    "STATUS_NEEDS_REVIEW",
    "ALL_STATUSES",
    "APPLY_PENDING",
    "APPLY_APPLIED",
    "APPLY_SKIPPED",
    "APPLY_PACKET_READY",
    "get_connection",
    "update_job",
    "migrate_apply_columns",
    "migrate_jobs_schema",
    "migrate_pipeline_columns",
    "dedupe_existing_jobs",
    "fetch_green_queue",
    "fetch_job",
]


def migrate_apply_columns(db: sqlite3.Connection) -> None:
    columns = [
        ("apply_status", "TEXT DEFAULT 'need_to_apply'"),
        ("packet_generated_at", "TEXT"),
        ("application_packet", "TEXT"),
        ("applied_at", "TEXT"),
        ("notes", "TEXT"),
        ("country", "TEXT DEFAULT 'US'"),
        ("location_review", "TEXT"),
    ]
    for name, typedef in columns:
        try:
            db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {typedef}")
        except sqlite3.OperationalError:
            pass
    db.commit()


def migrate_jobs_schema(db: sqlite3.Connection) -> None:
    cols = [
        ("canonical_job_key", "TEXT"),
        ("first_seen_at", "TEXT"),
        ("last_seen_at", "TEXT"),
        ("seen_count", "INTEGER DEFAULT 1"),
        ("duplicate_of", "TEXT"),
        ("expired", "INTEGER DEFAULT 0"),
    ]
    for name, typedef in cols:
        try:
            db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {typedef}")
        except sqlite3.OperationalError:
            pass
    try:
        db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_canonical_job_key "
            "ON jobs(canonical_job_key) WHERE canonical_job_key IS NOT NULL"
        )
    except sqlite3.OperationalError:
        pass
    db.commit()


def migrate_pipeline_columns(db: sqlite3.Connection) -> None:
    cols = [
        ("resume_variant", "TEXT"),
        ("role_category", "TEXT"),
        ("recruiter_data", "TEXT"),
    ]
    for name, typedef in cols:
        try:
            db.execute(f"ALTER TABLE jobs ADD COLUMN {name} {typedef}")
        except sqlite3.OperationalError:
            pass
    db.commit()


def dedupe_existing_jobs(db: sqlite3.Connection) -> int:
    """Mark duplicate rows sharing canonical_job_key. Returns count marked."""
    rows = db.execute(
        "SELECT id, canonical_job_key, first_seen_at FROM jobs "
        "WHERE canonical_job_key IS NOT NULL AND canonical_job_key != '' "
        "ORDER BY first_seen_at ASC"
    ).fetchall()
    seen = {}
    marked = 0
    for jid, ckey, _ in rows:
        if ckey in seen:
            db.execute(
                "UPDATE jobs SET duplicate_of=? WHERE id=? AND (duplicate_of IS NULL OR duplicate_of='')",
                (seen[ckey], jid),
            )
            marked += 1
        else:
            seen[ckey] = jid
    db.commit()
    return marked


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    migrate_apply_columns(conn)
    migrate_jobs_schema(conn)
    migrate_pipeline_columns(conn)
    return conn


def update_job(job_id: str, **fields) -> None:
    allowed = {
        "apply_status",
        "packet_generated_at",
        "application_packet",
        "applied_at",
        "notes",
        "country",
        "location_review",
        "last_seen_at",
        "seen_count",
        "duplicate_of",
        "expired",
        "resume_variant",
        "role_category",
        "recruiter_data",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    sets = ", ".join(f"{k}=?" for k in updates)
    vals = list(updates.values()) + [job_id]
    conn = get_connection()
    try:
        conn.execute(f"UPDATE jobs SET {sets} WHERE id=?", vals)
        conn.commit()
    finally:
        conn.close()


def fetch_job(job_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def fetch_green_queue(status_filter: str | None = None, green_only: bool = True) -> list[dict]:
    conn = get_connection()
    try:
        query = "SELECT * FROM jobs WHERE score >= 75" if green_only else "SELECT * FROM jobs WHERE 1=1"
        params = []
        if status_filter and status_filter != "all":
            if status_filter == "not_applied":
                query += (
                    " AND (apply_status IS NULL OR apply_status IN "
                    "('', 'need_to_apply', 'new', 'pending', 'ready_to_apply'))"
                )
            else:
                query += " AND apply_status=?"
                params.append(status_filter)
        query += " AND (duplicate_of IS NULL OR duplicate_of='')"
        query += " ORDER BY score DESC, seen_at DESC"
        rows = conn.execute(query, params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def run_migrations() -> dict:
    conn = get_connection()
    try:
        marked = dedupe_existing_jobs(conn)
        return {"dedupe_marked": marked, "migrated_at": datetime.now().isoformat()}
    finally:
        conn.close()
