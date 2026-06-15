"""
Optional Gmail sync — disabled by default.
Set ENABLE_GMAIL_SYNC=true and configure Gmail API credentials to enable.
"""
import logging
import os

log = logging.getLogger("alligator_apply")

EMAIL_CATEGORIES = [
    "recruiter_response",
    "interview_invite",
    "assessment",
    "rejection",
    "offer",
]


def gmail_sync_enabled() -> bool:
    return os.environ.get("ENABLE_GMAIL_SYNC", "false").lower() in ("true", "1", "yes")


def sync_gmail_inbox() -> dict:
    """Placeholder — requires Gmail API setup. Not required for local run."""
    if not gmail_sync_enabled():
        return {
            "enabled": False,
            "message": "Gmail sync disabled. Set ENABLE_GMAIL_SYNC=true to enable later.",
            "classified": [],
        }
    log.info("Gmail sync requested but not configured — add Gmail API credentials.")
    return {
        "enabled": True,
        "configured": False,
        "message": "Gmail sync flag is on but API credentials are not configured.",
        "classified": [],
    }


def classify_email(subject: str, body: str) -> str:
    """Rule-based email classification for future Gmail integration."""
    text = f"{subject} {body}".lower()
    if any(w in text for w in ("offer", "congratulations", "pleased to offer")):
        return "offer"
    if any(w in text for w in ("interview", "schedule a call", "phone screen", "onsite")):
        return "interview_invite"
    if any(w in text for w in ("assessment", "take-home", "coding challenge", "hackerrank")):
        return "assessment"
    if any(w in text for w in ("unfortunately", "not moving forward", "other candidates", "rejected")):
        return "rejection"
    if any(w in text for w in ("recruiter", "talent", "hiring", "opportunity")):
        return "recruiter_response"
    return "recruiter_response"
