"""Application packet generation with validation and visible errors."""
import json
import os
import traceback
from datetime import datetime
from typing import Any

import pandas as pd

from utils.application_packets import generate_and_save_full_packet, packet_path
from utils.apply_db import STATUS_READY_TO_APPLY, fetch_job, update_job
from utils.apply_logging import packet_log, record_packet_error
from resume_parser import get_resume_status, load_resume

READY_MIN_SCORE = 65


class PacketError(Exception):
    """Raised when packet generation cannot proceed."""

    def __init__(self, message: str, details: list[str] | None = None):
        self.details = details or []
        super().__init__(message)


def validate_packet_job(row: pd.Series | dict) -> list[str]:
    errors = []
    if isinstance(row, pd.Series):
        row = row.to_dict()

    resume = get_resume_status()
    if not resume.get("loaded"):
        errors.append(f"Missing resume: {resume.get('error', 'Set APPLICANT_RESUME_PATH')}")

    apply_url = (row.get("apply_url") or row.get("url") or "").strip()
    if not apply_url or not apply_url.startswith("http"):
        errors.append("Missing apply_url — job has no valid application link")

    role = (row.get("role") or row.get("title") or "").strip()
    company = (row.get("company") or "").strip()
    if not role:
        errors.append("Missing job title")
    if not company:
        errors.append("Missing company name")

    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key or not key.startswith("sk-"):
        errors.append("OpenAI API key not loaded — check OPENAI_API_KEY in .env")

    return errors


def _fetch_job_description(job: dict) -> str:
    url = job.get("url") or job.get("apply_url") or ""
    desc = job.get("description") or ""
    if desc and len(desc) > 100:
        return desc[:3000]
    try:
        from scrapers.jd_fetcher import fetch_full_jd
        full = fetch_full_jd(url)
        if full and len(full) > 100:
            return full[:3000]
    except Exception as e:
        packet_log.warning("JD fetch failed for %s: %s", url, e)
    if role := job.get("title") or job.get("role"):
        return f"{role} at {job.get('company', '')}"
    return ""


def _json_safe(obj: Any) -> Any:
    """Remove circular references for DB storage."""
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items() if k != "contacts" or not isinstance(v, dict)}
    if isinstance(obj, list):
        return [_json_safe(x) for x in obj]
    return obj


def generate_job_packet(row: pd.Series | dict, move_to_ready: bool = True) -> dict:
    """
    Generate packet, save markdown + DB. Returns result dict with path/status.
    Raises PacketError on validation or generation failure.
    """
    errors = validate_packet_job(row)
    if errors:
        msg = "; ".join(errors)
        record_packet_error(msg)
        raise PacketError(msg, errors)

    if isinstance(row, pd.Series):
        row = row.to_dict()

    job_id = row["id"]
    job = {
        "id": job_id,
        "title": row.get("role", ""),
        "role": row.get("role", ""),
        "company": row.get("company", ""),
        "url": row.get("apply_url", ""),
        "apply_url": row.get("apply_url", ""),
        "score": row.get("match_score", 0),
        "match_score": row.get("match_score", 0),
        "description": _fetch_job_description(row),
        "notes": row.get("notes") or "",
    }

    variant_content: dict = {}
    try:
        from utils.resume_variants import generate_and_save_variant
        variant_content, _ = generate_and_save_variant(job)
        packet_log.info("Resume variant saved for %s @ %s", job["title"], job["company"])
    except Exception as e:
        packet_log.warning("Resume variant skipped: %s", e)

    try:
        packet, md_path = generate_and_save_full_packet(job, variant_content or None)
    except json.JSONDecodeError as e:
        msg = f"OpenAI returned invalid JSON: {e}"
        record_packet_error(msg)
        packet_log.error(msg)
        raise PacketError(msg, [str(e)]) from e
    except Exception as e:
        err_type = type(e).__name__
        msg = f"OpenAI/packet error ({err_type}): {e}"
        record_packet_error(msg + "\n" + traceback.format_exc()[-500:])
        packet_log.error(msg, exc_info=True)
        raise PacketError(msg, [str(e)]) from e

    # Clean payload for DB — no circular refs
    db_packet = {
        "why_match": packet.get("why_match", ""),
        "resume_summary": packet.get("resume_summary", ""),
        "resume_bullets": packet.get("resume_bullets", []),
        "keywords": packet.get("keywords", []),
        "cover_letter": packet.get("cover_letter", ""),
        "recruiter_message": packet.get("recruiter_message", ""),
        "linkedin_note": packet.get("linkedin_note", ""),
        "answers": packet.get("answers", {}),
        "keyword_gaps": packet.get("keyword_gaps", {}),
        "markdown_path": md_path,
    }

    now = datetime.now().isoformat()
    try:
        update_fields = {
            "application_packet": json.dumps(db_packet),
            "packet_generated_at": now,
            "resume_variant": variant_content.get("variant", ""),
            "notes": job.get("notes") or "",
        }
        if move_to_ready:
            update_fields["apply_status"] = STATUS_READY_TO_APPLY
        update_job(job_id, **update_fields)
    except Exception as e:
        msg = f"Database write error: {e}"
        record_packet_error(msg)
        raise PacketError(msg, [str(e)]) from e

    packet_log.info("Packet saved: %s (job %s)", md_path, job_id)
    record_packet_error("")  # clear last error

    return {
        "packet": db_packet,
        "path": md_path,
        "packet_generated_at": now,
        "status": STATUS_READY_TO_APPLY if move_to_ready else row.get("status"),
    }


def packet_status_for_row(row: pd.Series | dict) -> dict:
    if isinstance(row, pd.Series):
        row = row.to_dict()
    has_packet = bool(row.get("application_packet"))
    md_path = ""
    if has_packet:
        try:
            pkt = json.loads(row["application_packet"])
            md_path = pkt.get("markdown_path") or packet_path(
                row.get("company", ""), row.get("role", "")
            )
        except Exception:
            md_path = packet_path(row.get("company", ""), row.get("role", ""))
    elif row.get("company") and row.get("role"):
        candidate = packet_path(row.get("company", ""), row.get("role", ""))
        if os.path.exists(candidate):
            md_path = candidate
            has_packet = True

    return {
        "status_label": "Generated" if has_packet else "Missing",
        "generated_at": row.get("packet_generated_at") or "",
        "markdown_path": md_path if has_packet else "",
    }
