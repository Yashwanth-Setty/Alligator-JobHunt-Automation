"""Resume variant selection and tailored content generation."""
import json
import logging
import os
import re
from datetime import datetime

from utils.openai_client import complete

log = logging.getLogger("alligator_apply")

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VARIANTS_DIR = os.path.join(BASE, "outputs", "resume_variants")

RESUME_VARIANTS = {
    "java_backend": {
        "label": "Java Backend Resume",
        "keywords": ["java", "spring boot", "spring", "microservices", "backend", "kotlin", "jvm"],
    },
    "java_aws": {
        "label": "Java AWS Resume",
        "keywords": ["java", "aws", "cloud", "lambda", "ecs", "spring boot", "microservices"],
    },
    "java_full_stack": {
        "label": "Java Full Stack Resume",
        "keywords": ["full stack", "full-stack", "react", "java", "node", "frontend", "backend"],
    },
    "ai_engineer": {
        "label": "AI Engineer Resume",
        "keywords": ["ai", "ml", "llm", "rag", "langchain", "genai", "machine learning", "pytorch"],
    },
}

CPT_VISA_DEFAULT = (
    "I am authorized to work in the United States under Full-Time CPT through my "
    "university. I may require future employment sponsorship depending on "
    "long-term employment status."
)


def _resume_text() -> str:
    from resume_parser import get_resume_context_for_prompt
    text = get_resume_context_for_prompt()
    if text and len(text) > 100:
        return text
    return ""


def select_resume_variant(job: dict) -> str:
    """Pick best resume variant from job title/description."""
    text = f"{job.get('title', '')} {job.get('description', '')}".lower()
    scores = {}
    for key, meta in RESUME_VARIANTS.items():
        scores[key] = sum(1 for kw in meta["keywords"] if kw in text)
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return "java_backend"
    return best


def _safe_filename(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text or "")
    return re.sub(r"[-\s]+", "_", text).strip("_").lower()[:80] or "job"


def generate_resume_variant_content(job: dict, variant_key: str | None = None) -> dict:
    """Generate tailored summary, bullets, keywords — no fabricated experience."""
    variant_key = variant_key or select_resume_variant(job)
    variant = RESUME_VARIANTS.get(variant_key, RESUME_VARIANTS["java_backend"])
    resume = _resume_text()
    if not resume:
        raise ValueError("Resume not loaded. Set APPLICANT_RESUME_PATH before generating variants.")

    prompt = f"""Rewrite ONLY based on the candidate's real resume below. Do NOT invent employers, degrees, or tools.

RESUME VARIANT: {variant['label']}
JOB: {job.get('title', '')} @ {job.get('company', '')}
LOCATION: {job.get('location', '')}

CANDIDATE RESUME:
{resume}

Return ONLY JSON:
{{
  "variant": "{variant_key}",
  "variant_label": "{variant['label']}",
  "professional_summary": "<3-4 sentences tailored to this job>",
  "bullets": ["<bullet1>", "<bullet2>", "<bullet3>", "<bullet4>", "<bullet5>"],
  "keyword_additions": ["<kw1>", "<kw2>", "<kw3>", "<kw4>", "<kw5>"]
}}

Rules:
- Bullets must reframe REAL experience from the resume.
- Never claim tools or employers not in the resume.
- Match the {variant['label']} angle.
"""
    raw = complete([{"role": "user", "content": prompt}], temperature=0.3)
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else parts[0]
        if raw.startswith("json"):
            raw = raw[4:]
    data = json.loads(raw.strip())
    data["variant"] = variant_key
    data["variant_label"] = variant["label"]
    data["bullets"] = [str(b) for b in data.get("bullets", [])[:5]]
    data["keyword_additions"] = [str(k) for k in data.get("keyword_additions", [])[:10]]
    return data


def save_resume_variant(job: dict, content: dict) -> str:
    os.makedirs(VARIANTS_DIR, exist_ok=True)
    fname = f"{_safe_filename(job.get('company', ''))}_{_safe_filename(job.get('title', ''))}_{content.get('variant', 'default')}.md"
    path = os.path.join(VARIANTS_DIR, fname)
    lines = [
        f"# {content.get('variant_label', 'Resume Variant')} — {job.get('title', '')} @ {job.get('company', '')}",
        f"Generated: {datetime.now().isoformat()}",
        "",
        "## Professional Summary",
        content.get("professional_summary", ""),
        "",
        "## Tailored Bullets",
    ]
    for i, b in enumerate(content.get("bullets", []), 1):
        lines.append(f"{i}. {b}")
    lines.extend(["", "## Keywords to Add"])
    for kw in content.get("keyword_additions", []):
        lines.append(f"- {kw}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path


def generate_and_save_variant(job: dict) -> tuple[dict, str]:
    content = generate_resume_variant_content(job)
    path = save_resume_variant(job, content)
    return content, path
