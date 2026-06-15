"""System diagnostics for dashboard."""
import os
import shutil

import utils.env_loader  # noqa: F401

from resume_parser import get_resume_status, resolve_resume_path
from utils.apply_logging import read_last_apply_error, read_last_packet_error
from utils.apply_profile import get_apply_profile, profile_complete
from utils.dashboard_core import BASE, DB_PATH, load_jobs_df, ready_to_apply_jobs, active_usa_jobs

READY_MIN_SCORE = 65


def _openai_key_loaded() -> bool:
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    return bool(key and key.startswith("sk-") and len(key) > 20)


def _playwright_installed() -> bool:
    try:
        import playwright  # noqa: F401
        return True
    except ImportError:
        return False


def _chromium_installed() -> bool:
    if not _playwright_installed():
        return False
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            exe = p.chromium.executable_path
            return bool(exe and os.path.exists(exe))
    except Exception:
        return False


def get_diagnostics() -> dict:
    resume = get_resume_status()
    profile = get_apply_profile()
    prof_ok, prof_missing = profile_complete(profile)

    df = load_jobs_df()
    base = active_usa_jobs(df) if not df.empty else df
    with_url = base[base["apply_url"].fillna("").str.startswith("http")] if not base.empty else base
    eligible = ready_to_apply_jobs(base) if not base.empty else base
    ready = eligible[eligible["status"] == "ready_to_apply"] if not eligible.empty else eligible

    return {
        "openai_key_loaded": _openai_key_loaded(),
        "resume_path_exists": bool(resume.get("loaded")),
        "resume_path": resume.get("file_path", ""),
        "applicant_profile_complete": prof_ok,
        "applicant_profile_missing": prof_missing,
        "playwright_installed": _playwright_installed(),
        "chromium_installed": _chromium_installed(),
        "jobs_with_apply_url": len(with_url),
        "jobs_eligible_for_packet": len(eligible),
        "jobs_ready_to_apply": len(ready),
        "last_packet_error": read_last_packet_error(),
        "last_apply_error": read_last_apply_error(),
        "launch_script_exists": os.path.exists(os.path.join(BASE, "launch_apply.py")),
        "test_form_exists": os.path.exists(os.path.join(BASE, "test_data", "apply_test_form.html")),
    }
