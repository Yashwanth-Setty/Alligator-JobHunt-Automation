"""Mock auto-apply API — placeholder until full Playwright/watsonx integration."""
import json
import random
from datetime import datetime

from utils.application_service import (
    add_manual_review,
    record_auto_apply_attempt,
    update_application,
)
from utils.dashboard_core import launch_apply_browser

PAUSE_FIELDS = ["visa", "eeo", "salary", "captcha", "final_submit"]

_MOCK_FAILURE_REASONS = [
    ("captcha", "CAPTCHA detected — manual completion required"),
    ("complex_workday_form", "Complex Workday form — multi-step manual flow"),
    ("visa_question", "Visa sponsorship question requires manual answer"),
    ("unknown_field", "Unknown required field on application form"),
    ("file_upload_issue", "Resume upload field not recognized"),
]


def _now() -> str:
    return datetime.now().isoformat()


def check_auto_apply_eligibility(job: dict) -> tuple[bool, str]:
    score = int(job.get("match_score") or job.get("score") or 0)
    url = (job.get("apply_url") or job.get("url") or "").strip()
    if score < 65:
        return False, "Match score below 65"
    if not url.startswith("http"):
        return False, "Missing apply URL"
    if job.get("auto_apply_eligible") == 0:
        return False, "Marked ineligible"
    low = url.lower()
    if "workday" in low:
        return False, "Workday forms require manual review"
    if "icims" in low:
        return False, "iCIMS complex form"
    return True, "Eligible"


def mock_auto_apply_job(job_id: str, job: dict) -> dict:
    """Simulate auto-apply: fills safe fields, pauses on sensitive, never auto-submits."""
    eligible, reason = check_auto_apply_eligibility(job)
    if not eligible:
        review_id = add_manual_review(job_id, _map_reason(reason), reason)
        record_auto_apply_attempt(job_id, "failed", reason)
        return {
            "success": False,
            "job_id": job_id,
            "status": "manual_pending",
            "reason": reason,
            "manual_review_id": review_id,
            "message": f"Moved to Manual Review: {reason}",
        }

    # ~15% simulated failure for demo variety
    if random.random() < 0.15:
        code, detail = random.choice(_MOCK_FAILURE_REASONS)
        review_id = add_manual_review(job_id, code, detail)
        record_auto_apply_attempt(job_id, "paused", detail, json.dumps(PAUSE_FIELDS))
        update_application(job_id, pipeline_status="manual_pending")
        return {
            "success": False,
            "job_id": job_id,
            "status": "manual_pending",
            "reason": detail,
            "manual_review_id": review_id,
            "paused_at": PAUSE_FIELDS,
            "message": detail,
        }

    filled = ["name", "email", "phone", "resume", "cover_letter"]
    record_auto_apply_attempt(
        job_id,
        "paused",
        "Paused before sensitive fields — review in browser",
        json.dumps(filled + PAUSE_FIELDS),
    )
    update_application(job_id, pipeline_status="auto_applied", date_applied=_now())
    return {
        "success": True,
        "job_id": job_id,
        "status": "auto_applied",
        "fields_filled": filled,
        "paused_at": PAUSE_FIELDS,
        "message": "Safe fields autofilled. Paused at visa/EEO/salary/CAPTCHA — submit manually.",
        "launch_available": True,
    }


def mock_auto_apply_batch(jobs: list[dict]) -> dict:
    """Auto-apply all eligible jobs in batch (mock)."""
    results = {"applied": 0, "manual": 0, "skipped": 0, "details": []}
    for job in jobs:
        jid = job.get("id") or job.get("job_id")
        if not jid:
            continue
        eligible, _ = check_auto_apply_eligibility(job)
        if not eligible:
            results["skipped"] += 1
            continue
        out = mock_auto_apply_job(jid, job)
        if out["success"]:
            results["applied"] += 1
        else:
            results["manual"] += 1
        results["details"].append(out)
    return results


def launch_apply_for_job(job_id: str, test_mode: bool = False) -> tuple[bool, str, list[str]]:
    """Bridge to real Playwright launcher (still no auto-submit)."""
    return launch_apply_browser(job_id, test_mode=test_mode)


def _map_reason(text: str) -> str:
    low = text.lower()
    for code, _ in _MOCK_FAILURE_REASONS:
        if code.replace("_", " ") in low or code in low:
            return code
    if "score" in low:
        return "missing_required_data"
    if "url" in low:
        return "missing_required_data"
    return "auto_apply_failed"
