"""Semi-auto application packet generation (assist only — no submission)."""
import json
import logging
import os
import re
from datetime import datetime

from utils.openai_client import complete

log = logging.getLogger("alligator_apply")

PACKETS_DIR = os.path.join(
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..")),
    "outputs",
    "application_packets",
)

CPT_VISA_DEFAULT = (
    "I am authorized to work in the United States under Full-Time CPT through my "
    "university. I may require future employment sponsorship depending on "
    "long-term employment status."
)

# CPT-safe reference templates — suggestions only; never auto-submitted.
CPT_ANSWER_TEMPLATES = {
    "legally_authorized_us": {
        "label": "Are you legally authorized to work in the US?",
        "suggestion": CPT_VISA_DEFAULT,
        "requires_confirmation": True,
        "note": (
            "Confirm your I-20 CPT dates and employer details match this role "
            "before submitting. Do not submit if your CPT is not yet approved."
        ),
    },
    "require_sponsorship": {
        "label": "Will you now or in the future require sponsorship?",
        "suggestion": CPT_VISA_DEFAULT,
        "requires_confirmation": True,
        "note": (
            "Read each form carefully. 'Now' vs 'in the future' may differ. "
            "CPT does not require employer H-1B sponsorship during authorized CPT work."
        ),
    },
    "work_authorization_status": {
        "label": "Work authorization status",
        "suggestion": CPT_VISA_DEFAULT,
        "requires_confirmation": True,
        "note": "Attach CPT authorization details only if the employer requests them.",
    },
    "expected_salary": {
        "label": "Expected salary",
        "suggestion": (
            "Open to discussion based on role scope, level, and location. "
            "[Enter your target range after researching levels.fyi / Glassdoor for this title.]"
        ),
        "requires_confirmation": True,
        "note": "You must enter a number/range yourself before submitting.",
    },
    "earliest_start_date": {
        "label": "Earliest start date",
        "suggestion": (
            "[Enter date — typically 2 weeks from offer or aligned with your "
            "CPT start date on I-20.]"
        ),
        "requires_confirmation": True,
        "note": "Must align with CPT authorization dates on your I-20.",
    },
    "why_interested": {
        "label": "Why are you interested in this role/company?",
        "suggestion": "(AI-generated below — personalize before submitting.)",
        "requires_confirmation": False,
        "note": "Edit to sound natural and specific to the company.",
    },
    "relevant_experience": {
        "label": "Relevant experience",
        "suggestion": "(AI-generated below — verify all claims match your resume.)",
        "requires_confirmation": False,
        "note": "Do not claim skills you cannot demonstrate in interviews.",
    },
}


def safe_packet_filename(company: str, title: str) -> str:
    raw = f"{company}_{title}"
    raw = re.sub(r"[^\w\s-]", "", raw, flags=re.UNICODE)
    raw = re.sub(r"[-\s]+", "_", raw).strip("_")
    return (raw[:100] or "application").lower()


def packet_path(company: str, title: str) -> str:
    os.makedirs(PACKETS_DIR, exist_ok=True)
    return os.path.join(PACKETS_DIR, f"{safe_packet_filename(company, title)}.md")


def _resume_context() -> str:
    from resume_parser import get_resume_context_for_prompt
    text = get_resume_context_for_prompt()
    if text and len(text) > 100:
        return text
    return ""


def generate_full_packet(job: dict, resume_variant: dict | None = None) -> dict:
    """Full application packet for Ready To Apply jobs."""
    resume = _resume_context()
    if not resume:
        raise ValueError("Resume not loaded. Set APPLICANT_RESUME_PATH before generating packets.")
    from resume_parser import analyze_keyword_gaps
    title = job.get("title", "") or job.get("role", "")
    company = job.get("company", "")
    score = job.get("score", 0) or job.get("match_score", 0)
    url = job.get("url", "") or job.get("apply_url", "")
    variant_label = (resume_variant or {}).get("variant_label", "")

    gaps = analyze_keyword_gaps(f"{title} {company} {job.get('description', '')}")

    prompt = f"""Create a USA job application packet. Return ONLY JSON:
{{
  "why_match": "<why this job matches the candidate>",
  "resume_summary": "<3-4 sentence tailored professional summary>",
  "resume_bullets": ["<b1>","<b2>","<b3>","<b4>","<b5>"],
  "keywords": ["<kw1>","<kw2>","<kw3>","<kw4>","<kw5>"],
  "cover_letter": "<short cover letter under 220 words>",
  "recruiter_message": "<short recruiter outreach under 120 words>",
  "linkedin_note": "<LinkedIn connection note under 300 chars>",
  "answers": {{
    "authorized_us": "{CPT_VISA_DEFAULT}",
    "sponsorship": "{CPT_VISA_DEFAULT}",
    "work_auth_status": "{CPT_VISA_DEFAULT}",
    "earliest_start_date": "<suggested date>",
    "expected_salary": "<research-based range placeholder>",
    "why_interested": "<2-3 sentences>"
  }}
}}

CANDIDATE RESUME:
{resume}

JOB: {title} @ {company} ({score}% match)
URL: {url}
Resume variant: {variant_label}
Keyword gaps to address (suggest honest additions only): {', '.join(gaps.get('missing', [])[:10]) or 'none detected'}

Rules:
- Do NOT invent experience. Rewrite only from resume.
- Visa answers are CPT-safe suggestions — user confirms manually.
- Never imply auto-submission.
"""
    raw = complete([{"role": "user", "content": prompt}], temperature=0.35)
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else parts[0]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw.strip())
    answers = data.get("answers", {})
    answers["authorized_us"] = CPT_VISA_DEFAULT
    answers["sponsorship"] = CPT_VISA_DEFAULT
    answers["work_auth_status"] = CPT_VISA_DEFAULT
    data["answers"] = answers
    data["resume_bullets"] = [str(b) for b in data.get("resume_bullets", [])[:5]]
    data["keywords"] = [str(k) for k in data.get("keywords", [])[:10]]
    data["keyword_gaps"] = gaps
    data["markdown_path"] = ""  # set by generate_and_save_full_packet
    return data


def generate_and_save_full_packet(job: dict, resume_variant: dict | None = None) -> tuple[dict, str]:
    content = generate_full_packet(job, resume_variant)
    md = format_full_packet_markdown(job, content)
    path = packet_path(job.get("company", ""), job.get("title", "") or job.get("role", ""))
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    content["markdown_path"] = path
    log.info("Full application packet saved: %s", path)
    return content, path


def format_full_packet_markdown(job: dict, content: dict, recruiter: dict | None = None) -> str:
    title = job.get("title", "") or job.get("role", "?")
    company = job.get("company", "?")
    score = job.get("score", 0) or job.get("match_score", 0)
    url = job.get("url", "") or job.get("apply_url", "")
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        f"# Application Packet — {title} @ {company}",
        "",
        f"**Match:** {score}%  ",
        f"**Apply:** {url}  ",
        f"**Generated:** {generated}",
        "",
        "> MANUAL APPLY ONLY — Review all content before submitting.",
        "",
        "## Why this job matches me",
        content.get("why_match", ""),
        "",
        "## Tailored resume summary",
        content.get("resume_summary", ""),
        "",
        "## 5 resume bullet suggestions",
    ]
    for i, b in enumerate(content.get("resume_bullets", []), 1):
        lines.append(f"{i}. {b}")
    lines.extend([
        "",
        "## Keywords to add",
    ])
    for kw in content.get("keywords", []):
        lines.append(f"- {kw}")
    lines.extend([
        "",
        "## Cover letter",
        content.get("cover_letter", ""),
        "",
        "## Recruiter message",
        content.get("recruiter_message", ""),
        "",
        "## LinkedIn connection note",
        content.get("linkedin_note", ""),
        "",
        "## Application answers (CPT-safe — confirm manually)",
    ])
    a = content.get("answers", {})
    for label, key in [
        ("Authorized to work in US", "authorized_us"),
        ("Sponsorship", "sponsorship"),
        ("Work authorization", "work_auth_status"),
        ("Earliest start", "earliest_start_date"),
        ("Expected salary", "expected_salary"),
        ("Why interested", "why_interested"),
    ]:
        lines.append(f"- **{label}:** {a.get(key, '')}")

    if recruiter:
        lines.extend([
            "",
            "## Recruiter discovery (public sources only)",
            f"- Careers page: {recruiter.get('careers_page', '')}",
            f"- Recruiter: {recruiter.get('recruiter', 'See careers page')}",
            f"- Engineering manager: {recruiter.get('engineering_manager', 'N/A')}",
        ])
        drafts = recruiter.get("drafts", {})
        if drafts:
            lines.extend([
                "",
                "### Recruiter email draft",
                drafts.get("recruiter_email", ""),
                "",
                "### Follow-up message",
                drafts.get("follow_up_message", ""),
            ])

    lines.extend([
        "",
        "---",
        "Visa/CPT answers are suggestions only. Never auto-submit.",
    ])
    return "\n".join(lines)


def generate_packet_content(job: dict) -> dict:
    """Generate tailored application content via OpenAI (assist only)."""
    resume = _resume_context()
    title = job.get("title", "")
    company = job.get("company", "")
    score = job.get("score", 0)
    url = job.get("url", "")

    prompt = f"""You are helping a candidate prepare a job application packet manually.
Do NOT claim the application will be submitted automatically.

CANDIDATE RESUME / SKILLS:
{resume}

JOB:
Title: {title}
Company: {company}
Match score: {score}%
URL: {url}

Return ONLY valid JSON (no markdown fences):
{{
  "resume_summary": "<3-4 sentence tailored summary>",
  "resume_bullets": ["<bullet1>", "<bullet2>", "<bullet3>", "<bullet4>", "<bullet5>"],
  "cover_letter": "<short cover letter under 250 words>",
  "answers": {{
    "why_interested": "<2-3 sentences>",
    "relevant_experience": "<3-4 sentences citing real skills from resume>"
  }}
}}

Rules:
- Bullets must be achievement-oriented and match the job.
- Cover letter must be professional and specific to {company}.
- Do not invent employers, degrees, or tools not in the resume.
- Candidate is on F-1 CPT — do not answer visa forms in JSON (handled separately).
"""

    raw = complete(
        [{"role": "user", "content": prompt}],
        temperature=0.4,
    )
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else parts[0]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw.strip())
    if "resume_bullets" not in data:
        data["resume_bullets"] = []
    data["resume_bullets"] = [str(b) for b in data["resume_bullets"][:5]]
    return data


def format_packet_markdown(job: dict, content: dict) -> str:
    """Build full markdown packet with CPT templates and confirmation warnings."""
    title = job.get("title", "?")
    company = job.get("company", "?")
    score = job.get("score", 0)
    url = job.get("url", "")
    generated = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        f"# Application Packet — {title} @ {company}",
        "",
        f"**Match score:** {score}%  ",
        f"**Apply URL:** {url}  ",
        f"**Generated:** {generated}",
        "",
        "> **MANUAL APPLY ONLY** — This packet assists your application. "
        "> Nothing is submitted automatically. Review every answer before you apply.",
        "",
        "---",
        "",
        "## Tailored Resume Summary",
        "",
        content.get("resume_summary", ""),
        "",
        "## Tailored Resume Bullets",
        "",
    ]
    for i, bullet in enumerate(content.get("resume_bullets", []), 1):
        lines.append(f"{i}. {bullet}")
    lines.extend([
        "",
        "## Cover Letter",
        "",
        content.get("cover_letter", ""),
        "",
        "---",
        "",
        "## Suggested Answers",
        "",
        "*Visa and authorization answers below are templates only — "
        "you must confirm accuracy before submitting any form.*",
        "",
    ])

    ai_answers = content.get("answers", {})
    for key, tmpl in CPT_ANSWER_TEMPLATES.items():
        lines.append(f"### {tmpl['label']}")
        lines.append("")
        if key in ai_answers:
            lines.append(f"**AI draft:** {ai_answers[key]}")
            lines.append("")
        lines.append(f"**CPT-safe suggestion:** {tmpl['suggestion']}")
        lines.append("")
        if tmpl.get("requires_confirmation"):
            lines.append("⚠️ **Requires manual confirmation before submit**")
        if tmpl.get("note"):
            lines.append(f"*{tmpl['note']}*")
        lines.append("")

    lines.extend([
        "---",
        "",
        "## Checklist before you apply",
        "",
        "- [ ] Opened apply link and reviewed full job description",
        "- [ ] Confirmed CPT dates and employer match I-20",
        "- [ ] Verified all visa/authorization answers manually",
        "- [ ] Personalized cover letter and removed AI-sounding phrases",
        "- [ ] Uploaded correct resume version",
        "",
    ])
    return "\n".join(lines)


def generate_and_save_packet(job: dict) -> str:
    """Generate packet, write markdown file, return file path."""
    content = generate_packet_content(job)
    md = format_packet_markdown(job, content)
    path = packet_path(job.get("company", ""), job.get("title", ""))
    with open(path, "w", encoding="utf-8") as f:
        f.write(md)
    log.info("Application packet saved: %s", path)
    return path
