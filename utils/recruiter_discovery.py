"""Public recruiter / careers page discovery (no private data scraping)."""
import json
import logging
import re
from urllib.parse import urlparse

import httpx

log = logging.getLogger("alligator_apply")

CPT_VISA_DEFAULT = (
    "I am authorized to work in the United States under Full-Time CPT through my "
    "university. I may require future employment sponsorship depending on "
    "long-term employment status."
)


def _careers_url(company: str, apply_url: str) -> str:
    if apply_url:
        p = urlparse(apply_url)
        if p.netloc:
            return f"{p.scheme}://{p.netloc}/"
    slug = re.sub(r"[^\w]", "", (company or "").lower())
    return f"https://www.{slug}.com/careers"


def discover_recruiter_contacts(job: dict) -> dict:
    """
    Discover public careers/contact info only.
    Does not scrape personal emails or violate ToS.
    """
    company = job.get("company", "")
    apply_url = job.get("url", "") or job.get("apply_url", "")
    careers = _careers_url(company, apply_url)

    result = {
        "company": company,
        "careers_page": careers,
        "apply_url": apply_url,
        "hiring_manager": "",
        "recruiter": "",
        "engineering_manager": "",
        "contact_page": careers,
        "sources": ["public_careers_page"],
        "notes": "Use company careers page and LinkedIn company page for public contacts only.",
    }

    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            r = client.get(careers, headers={"User-Agent": "Mozilla/5.0"})
            if r.is_success:
                html = r.text.lower()
                if "talent acquisition" in html or "recruiting" in html:
                    result["recruiter"] = "See careers page — Talent Acquisition / Recruiting team"
                if "engineering" in html and "manager" in html:
                    result["engineering_manager"] = "See careers page — Engineering leadership listings"
    except Exception as e:
        log.debug(f"Careers page fetch: {e}")

    return result


def generate_outreach_drafts(job: dict, contacts: dict, packet: dict | None = None) -> dict:
    """Generate recruiter email, LinkedIn note, follow-up — user must send manually."""
    from utils.openai_client import complete

    packet = packet or {}
    title = job.get("title", "") or job.get("role", "")
    company = job.get("company", "")

    prompt = f"""Write outreach drafts for a job seeker. Return ONLY JSON:
{{
  "recruiter_email": "<short professional email under 150 words>",
  "linkedin_connection_note": "<under 300 characters>",
  "follow_up_message": "<short follow-up under 100 words>"
}}

Job: {title} @ {company}
Why match: {packet.get('why_match', packet.get('resume_summary', ''))}
Careers page: {contacts.get('careers_page', '')}

Rules:
- Professional, specific, not spammy.
- Mention interest in the role — do not claim auto-apply.
- Candidate is on Full-Time CPT — do not misstate visa status in outreach.
"""
    raw = complete([{"role": "user", "content": prompt}], temperature=0.4)
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else parts[0]
        if raw.startswith("json"):
            raw = raw[4:]
    drafts = json.loads(raw.strip())
    drafts["contacts"] = contacts
    return drafts
