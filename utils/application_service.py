"""Application CRUD, status history, and manual review."""
from datetime import datetime

from utils.apply_db import get_connection, update_job
from utils.db_schema import (
    PIPELINE_STATUSES,
    init_dashboard_schema,
    map_pipeline_to_apply_status,
    sync_applications_from_jobs,
)


def _now() -> str:
    return datetime.now().isoformat()


def ensure_synced() -> None:
    init_dashboard_schema()
    sync_applications_from_jobs()


def get_application(job_id: str) -> dict | None:
    ensure_synced()
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM applications WHERE job_id=?", (job_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_application(
    job_id: str,
    pipeline_status: str | None = None,
    notes: str | None = None,
    date_applied: str | None = None,
    next_followup_date: str | None = None,
    interview_stage: str | None = None,
    auto_apply_eligible: int | None = None,
) -> None:
    ensure_synced()
    app = get_application(job_id)
    if not app:
        sync_applications_from_jobs()
        app = get_application(job_id)
    if not app:
        return

    fields: dict = {"updated_at": _now()}
    if pipeline_status is not None:
        if pipeline_status not in PIPELINE_STATUSES:
            raise ValueError(f"Invalid status: {pipeline_status}")
        fields["pipeline_status"] = pipeline_status
    if notes is not None:
        fields["notes"] = notes
    if date_applied is not None:
        fields["date_applied"] = date_applied
    if next_followup_date is not None:
        fields["next_followup_date"] = next_followup_date
    if interview_stage is not None:
        fields["interview_stage"] = interview_stage
    if auto_apply_eligible is not None:
        fields["auto_apply_eligible"] = auto_apply_eligible

    sets = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [job_id]
    conn = get_connection()
    try:
        conn.execute(f"UPDATE applications SET {sets} WHERE job_id=?", vals)
        if pipeline_status is not None:
            conn.execute(
                "INSERT INTO application_status_history "
                "(application_id, job_id, from_status, to_status, note, changed_at) "
                "VALUES (?,?,?,?,?,?)",
                (
                    app["id"],
                    job_id,
                    app.get("pipeline_status"),
                    pipeline_status,
                    notes or "",
                    _now(),
                ),
            )
            apply_status = map_pipeline_to_apply_status(pipeline_status)
            job_fields: dict = {"apply_status": apply_status}
            if notes:
                job_fields["notes"] = notes
            if pipeline_status in ("applied", "auto_applied", "waiting") and date_applied:
                job_fields["applied_at"] = date_applied
            elif pipeline_status in ("applied", "auto_applied") and not date_applied:
                job_fields["applied_at"] = _now()
            update_job(job_id, **job_fields)
        conn.commit()
    finally:
        conn.close()


def list_manual_review(open_only: bool = True) -> list[dict]:
    ensure_synced()
    conn = get_connection()
    try:
        q = (
            "SELECT m.*, j.company, j.title, j.url, j.score "
            "FROM manual_review_items m "
            "JOIN jobs j ON j.id = m.job_id "
        )
        if open_only:
            q += "WHERE m.status='open' "
        q += "ORDER BY m.created_at DESC"
        return [dict(r) for r in conn.execute(q).fetchall()]
    finally:
        conn.close()


def add_manual_review(job_id: str, reason: str, details: str = "") -> int:
    ensure_synced()
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO manual_review_items (job_id, reason, details, status, created_at) "
            "VALUES (?,?,?,?,?)",
            (job_id, reason, details, "open", _now()),
        )
        update_application(job_id, pipeline_status="manual_pending")
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def resolve_manual_review(review_id: int, status: str = "resolved") -> None:
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE manual_review_items SET status=?, resolved_at=? WHERE id=?",
            (status, _now(), review_id),
        )
        conn.commit()
    finally:
        conn.close()


def record_auto_apply_attempt(
    job_id: str,
    status: str,
    reason: str = "",
    fields_filled: str = "",
    application_id: str | None = None,
) -> int:
    ensure_synced()
    conn = get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO auto_apply_attempts "
            "(job_id, application_id, status, reason, fields_filled, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (job_id, application_id, status, reason, fields_filled, _now()),
        )
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def get_user_setting(key: str, default: str = "") -> str:
    init_dashboard_schema()
    conn = get_connection()
    try:
        row = conn.execute("SELECT value FROM user_settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else default
    finally:
        conn.close()


def set_user_setting(key: str, value: str) -> None:
    init_dashboard_schema()
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO user_settings (key, value, updated_at) VALUES (?,?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, value, _now()),
        )
        conn.commit()
    finally:
        conn.close()
