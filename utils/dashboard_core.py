"""Shared dashboard data loading and job actions."""
import json
import os
import re
import sqlite3
import subprocess
import sys
from datetime import datetime

import pandas as pd

from utils.apply_db import (
    STATUS_APPLIED,
    STATUS_INTERVIEWING,
    STATUS_NEED_TO_APPLY,
    STATUS_NEW,
    STATUS_READY_TO_APPLY,
    STATUS_REJECTED,
    STATUS_RECRUITER_CONTACTED,
    STATUS_SKIPPED,
    get_connection,
    update_job,
)
from utils.apply_logging import apply_log, record_apply_error
from utils.apply_profile import get_apply_profile, profile_complete, profile_complete_for_launch
from utils.packet_service import PacketError, generate_job_packet, packet_status_for_row, READY_MIN_SCORE
from utils.us_filter import classify_usa_job, is_usa_job

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(BASE, "jobs.db")
RUN_LOG = os.path.join(BASE, "logs", "last_run_output.txt")
SESSIONS_DIR = os.path.join(BASE, "outputs", "apply_sessions")
LAUNCH_SCRIPT = os.path.join(BASE, "launch_apply.py")
TEST_FORM = os.path.join(BASE, "test_data", "apply_test_form.html")

VISA_DEFAULT = (
    "I am authorized to work in the United States under Full-Time CPT through my "
    "university. I may require future employment sponsorship depending on "
    "long-term employment status."
)


def score_to_tier(score: int) -> str:
    if score >= 75:
        return "GREEN"
    if score >= 50:
        return "AMBER"
    return "RED"


def infer_location_display(title: str, url: str, stored: str = "") -> str:
    if stored and stored.strip():
        return stored.strip()
    text = f"{title} {url}".lower()
    if "remote" in text and any(k in text for k in ("us", "usa", "united states")):
        return "Remote (US)"
    if "hybrid" in text:
        return "Hybrid"
    if "remote" in text:
        return "Remote"
    for city in ("new york", "seattle", "san francisco", "austin", "chicago", "boston"):
        if city in text:
            return city.title()
    return ""


def _is_need_to_apply(status: str | None) -> bool:
    return (not status) or status in ("", STATUS_NEED_TO_APPLY, STATUS_NEW, "pending")


def load_jobs_df() -> pd.DataFrame:
    if not os.path.exists(DB_PATH):
        return pd.DataFrame()
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT id, company, title, url, source, score, seen_at, "
            "apply_status, applied_at, notes, country, location_review, "
            "application_packet, packet_generated_at, duplicate_of, expired, "
            "first_seen_at, last_seen_at, seen_count, resume_variant, role_category, "
            "recruiter_data, employment_type, remote_type, experience_level, "
            "salary_min, salary_max, date_posted, visa_fit, auto_apply_eligible "
            "FROM jobs ORDER BY score DESC, seen_at DESC"
        ).fetchall()
    finally:
        conn.close()

    out = []
    for row in rows:
        (
            jid, company, role, url, source, score, seen_at, apply_status, applied_at,
            notes, country, location_review, application_packet, packet_generated_at,
            duplicate_of, expired, first_seen_at, last_seen_at, seen_count,
            resume_variant, role_category, recruiter_data,
            employment_type, remote_type, experience_level,
            salary_min, salary_max, date_posted, visa_fit, auto_apply_eligible,
        ) = row
        score = int(score or 0)
        location = infer_location_display(role or "", url or "", location_review or "")
        desc = f"{role or ''} {company or ''} {url or ''}"
        usa_class = classify_usa_job(location, desc)
        if country and str(country).upper() in ("US", "USA") and usa_class == "needs_review":
            if is_usa_job(location, desc):
                usa_class = "usa"
        from utils.resume_variants import RESUME_VARIANTS
        variant_label = RESUME_VARIANTS.get(resume_variant or "", {}).get("label", resume_variant or "")
        pkt = packet_status_for_row({
            "application_packet": application_packet or "",
            "packet_generated_at": packet_generated_at or "",
            "company": company or "",
            "role": role or "",
        })
        out.append({
            "id": jid,
            "company": company or "",
            "role": role or "",
            "location": location,
            "match_score": score,
            "tier": score_to_tier(score),
            "visa_status": "CPT Compatible",
            "source": source or "",
            "apply_url": url or "",
            "status": apply_status or STATUS_NEED_TO_APPLY,
            "applied_at": applied_at or "",
            "notes": notes or "",
            "country": country or "US",
            "usa_class": usa_class,
            "application_packet": application_packet or "",
            "packet_generated_at": packet_generated_at or "",
            "packet_status": pkt["status_label"],
            "packet_md_path": pkt["markdown_path"],
            "duplicate_of": duplicate_of or "",
            "expired": int(expired or 0),
            "first_seen_at": first_seen_at or seen_at or "",
            "last_seen_at": last_seen_at or seen_at or "",
            "seen_count": int(seen_count or 1),
            "resume_variant": resume_variant or "",
            "resume_variant_label": variant_label,
            "role_category": role_category or "",
            "recruiter_data": recruiter_data or "",
            "employment_type": employment_type or "",
            "remote_type": remote_type or "",
            "experience_level": experience_level or "",
            "salary_min": salary_min,
            "salary_max": salary_max,
            "date_posted": date_posted or "",
            "visa_fit": visa_fit or "cpt_friendly",
            "auto_apply_eligible": bool(auto_apply_eligible),
        })
    return pd.DataFrame(out)


def active_usa_jobs(df: pd.DataFrame) -> pd.DataFrame:
    return df[
        (df["usa_class"] == "usa")
        & (df["duplicate_of"].fillna("") == "")
        & (df["expired"] != 1)
    ].copy()


def needs_review_jobs(df: pd.DataFrame) -> pd.DataFrame:
    return df[
        (df["usa_class"] == "needs_review")
        & (df["duplicate_of"].fillna("") == "")
        & (df["expired"] != 1)
    ].copy()


def ready_to_apply_jobs(df: pd.DataFrame) -> pd.DataFrame:
    """Eligible for Ready To Apply tab (score >= 65, has URL, USA, not duplicate/expired)."""
    if df.empty:
        return df
    return df[
        (df["match_score"] >= READY_MIN_SCORE)
        & (df["status"].isin([STATUS_NEED_TO_APPLY, STATUS_NEW, STATUS_READY_TO_APPLY, ""]))
        & (df["apply_url"].fillna("").str.startswith("http"))
    ].copy()


def run_scan() -> tuple[int, str]:
    lock = os.path.join(BASE, "alligator_apply.lock")
    if os.path.exists(lock):
        try:
            os.remove(lock)
        except OSError:
            pass
    proc = subprocess.run(
        [sys.executable, os.path.join(BASE, "main.py")],
        cwd=BASE,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = (proc.stdout or "") + (proc.stderr or "")
    os.makedirs(os.path.join(BASE, "logs"), exist_ok=True)
    with open(RUN_LOG, "w", encoding="utf-8") as f:
        f.write(output)
    return proc.returncode, output


def launch_apply_browser(job_id: str, test_mode: bool = False) -> tuple[bool, str, list[str]]:
    errors = []
    if not os.path.exists(LAUNCH_SCRIPT):
        return False, "launch_apply.py not found", ["launch_apply.py missing"]

    profile = get_apply_profile()
    ok, missing = profile_complete_for_launch(profile)
    if not ok:
        msg = f"Resume required for launch: {', '.join(missing)}"
        record_apply_error(msg)
        return False, msg, missing

    if not test_mode:
        from utils.apply_db import fetch_job
        job = fetch_job(job_id)
        if not job:
            msg = f"Job not found in database: {job_id}"
            record_apply_error(msg)
            return False, msg, [msg]
        url = (job.get("url") or "").strip()
        if not url.startswith("http"):
            msg = "Job has no valid apply_url"
            record_apply_error(msg)
            return False, msg, [msg]

    cmd = [sys.executable, LAUNCH_SCRIPT]
    if test_mode:
        cmd.append("--test")
    else:
        cmd.extend(["--job-id", job_id])

    try:
        creationflags = subprocess.CREATE_NEW_CONSOLE if sys.platform == "win32" else 0  # type: ignore
        subprocess.Popen(cmd, cwd=BASE, creationflags=creationflags)
        apply_log.info("Launched apply agent job_id=%s test=%s", job_id, test_mode)
        record_apply_error("")
        return True, "Browser launched in new window. Review and Submit manually — never auto-submits.", []
    except Exception as e:
        msg = f"Failed to launch browser: {e}"
        record_apply_error(msg)
        apply_log.error(msg, exc_info=True)
        return False, msg, [str(e)]


def load_apply_session(job_id: str) -> dict | None:
    path = os.path.join(SESSIONS_DIR, f"{job_id}.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def generate_full_job_packet(row: pd.Series, move_to_ready_flag: bool = True) -> dict:
    return generate_job_packet(row, move_to_ready=move_to_ready_flag)


def move_to_ready(job_id: str, notes: str = "") -> None:
    """Set apply_status to ready_to_apply and commit to jobs.db."""
    fields: dict = {"apply_status": STATUS_READY_TO_APPLY}
    if notes:
        fields["notes"] = notes
    update_job(job_id, **fields)


def mark_applied(job_id: str, notes: str = "") -> None:
    """Mark job as applied with timestamp."""
    fields: dict = {
        "apply_status": STATUS_APPLIED,
        "applied_at": datetime.now().isoformat(),
    }
    if notes:
        fields["notes"] = notes
    update_job(job_id, **fields)


def skip_job(job_id: str, notes: str = "") -> None:
    """Skip job."""
    fields: dict = {"apply_status": STATUS_SKIPPED}
    if notes:
        fields["notes"] = notes
    update_job(job_id, **fields)


def move_to_need_to_apply(job_id: str, notes: str = "") -> None:
    """Move job back to need_to_apply."""
    fields: dict = {"apply_status": STATUS_NEED_TO_APPLY, "applied_at": ""}
    if notes:
        fields["notes"] = notes
    update_job(job_id, **fields)


def set_job_status(job_id: str, status: str, notes: str = "") -> None:
    """Generic status update — prefer mark_applied / skip_job / move_to_ready when possible."""
    if status == STATUS_APPLIED:
        mark_applied(job_id, notes)
        return
    if status == STATUS_SKIPPED:
        skip_job(job_id, notes)
        return
    if status == STATUS_READY_TO_APPLY:
        move_to_ready(job_id, notes)
        return
    if status == STATUS_NEED_TO_APPLY:
        move_to_need_to_apply(job_id, notes)
        return
    fields: dict = {"apply_status": status}
    if notes:
        fields["notes"] = notes
    update_job(job_id, **fields)


__all__ = [
    "VISA_DEFAULT",
    "active_usa_jobs",
    "needs_review_jobs",
    "ready_to_apply_jobs",
    "load_jobs_df",
    "run_scan",
    "launch_apply_browser",
    "load_apply_session",
    "generate_full_job_packet",
    "move_to_ready",
    "mark_applied",
    "skip_job",
    "move_to_need_to_apply",
    "set_job_status",
    "_is_need_to_apply",
]
