"""Applicant profile loaded from environment + resume fallback for Playwright autofill."""
import os

from resume_parser import extract_applicant_contact, resolve_resume_path

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def get_apply_profile() -> dict:
    resume = resolve_resume_path() or ""
    resume_contact = extract_applicant_contact()

    def _pick(env_key: str, resume_key: str) -> str:
        val = os.environ.get(env_key, "").strip()
        if val:
            return val
        return resume_contact.get(resume_key, "")

    return {
        "full_name": _pick("APPLICANT_FULL_NAME", "full_name"),
        "email": _pick("APPLICANT_EMAIL", "email"),
        "phone": _pick("APPLICANT_PHONE", "phone"),
        "address": os.environ.get("APPLICANT_ADDRESS", "").strip(),
        "city": os.environ.get("APPLICANT_CITY", "").strip(),
        "state": os.environ.get("APPLICANT_STATE", "").strip(),
        "zip": os.environ.get("APPLICANT_ZIP", "").strip(),
        "linkedin": os.environ.get("APPLICANT_LINKEDIN", "").strip(),
        "github": os.environ.get("APPLICANT_GITHUB", "").strip(),
        "resume_path": resume,
    }


def profile_complete(profile: dict, for_launch: bool = False) -> tuple[bool, list[str]]:
    """
    for_launch=True: requires resume + name + email (from env or resume).
    for_launch=False: same minimum for packet generation context.
    """
    missing = []
    if not profile.get("resume_path") or not os.path.exists(profile.get("resume_path", "")):
        missing.append("APPLICANT_RESUME_PATH")
    if not profile.get("full_name"):
        missing.append("APPLICANT_FULL_NAME (or name in resume PDF)")
    if not profile.get("email"):
        missing.append("APPLICANT_EMAIL (or email in resume PDF)")
    return (len(missing) == 0, missing)


def profile_complete_for_launch(profile: dict) -> tuple[bool, list[str]]:
    """Launch requires resume path only; name/email recommended but filled from resume."""
    missing = []
    if not profile.get("resume_path") or not os.path.exists(profile.get("resume_path", "")):
        missing.append("APPLICANT_RESUME_PATH")
    return (len(missing) == 0, missing)
