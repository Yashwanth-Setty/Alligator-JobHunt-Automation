"""Primary resume source: APPLICANT_RESUME_PATH or resume.pdf in project root."""
import json
import logging
import os
import re
from datetime import datetime

log = logging.getLogger("alligator_apply")

BASE = os.path.abspath(os.path.dirname(__file__))
DEFAULT_RESUME_NAME = "resume.pdf"
RESUMES_DIR = os.path.join(BASE, "resumes")
CACHE_JSON = os.path.join(BASE, "resume_cache.json")

SECTION_PATTERNS = [
    ("professional_summary", re.compile(r"PROFESSIONAL\s+SUMMARY", re.I)),
    ("skills", re.compile(r"TECHNICAL\s+SKILLS|^SKILLS$", re.I | re.M)),
    ("experience", re.compile(r"PROFESSIONAL\s+EXPERIENCE|^EXPERIENCE$", re.I | re.M)),
    ("education", re.compile(r"^EDUCATION$", re.I | re.M)),
]


def resolve_resume_path() -> str | None:
    """APPLICANT_RESUME_PATH from .env, then resumes/ or project-root resume.pdf."""
    env_path = os.environ.get("APPLICANT_RESUME_PATH", "").strip()
    if env_path and os.path.exists(env_path):
        return os.path.abspath(env_path)
    for candidate in (
        os.path.join(RESUMES_DIR, DEFAULT_RESUME_NAME),
        os.path.join(BASE, DEFAULT_RESUME_NAME),
    ):
        if os.path.exists(candidate):
            return candidate
    return None


def _normalize_text(text: str) -> str:
    text = text.replace("\u2022", "•").replace("\ufffd", "•")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_pdf_text(path: str) -> tuple[str, int]:
    import pdfplumber

    pages = []
    with pdfplumber.open(path) as pdf:
        page_count = len(pdf.pages)
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                pages.append(t.strip())
    return _normalize_text("\n\n".join(pages)), page_count


def _extract_docx_text(path: str) -> tuple[str, int]:
    from docx import Document

    doc = Document(path)
    text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    return _normalize_text(text), 1


def _split_sections(full_text: str) -> dict[str, str]:
    """Split resume text into summary, skills, experience, education."""
    sections = {
        "professional_summary": "",
        "skills": "",
        "experience": "",
        "education": "",
    }
    if not full_text:
        return sections

    markers = []
    for key, pattern in SECTION_PATTERNS:
        for m in pattern.finditer(full_text):
            markers.append((m.start(), key, m.group(0)))
    markers.sort(key=lambda x: x[0])

    if not markers:
        sections["professional_summary"] = full_text[:2000]
        return sections

    for i, (start, key, _header) in enumerate(markers):
        end = markers[i + 1][0] if i + 1 < len(markers) else len(full_text)
        chunk = full_text[start:end]
        chunk = re.sub(r"^[^\n]+\n", "", chunk, count=1).strip()
        sections[key] = chunk.strip()

    return sections


def _extract_skill_tokens(skills_text: str) -> list[str]:
    if not skills_text:
        return []
    tokens = []
    for line in skills_text.splitlines():
        line = line.strip().lstrip("•-* ")
        if not line:
            continue
        if ":" in line:
            _, vals = line.split(":", 1)
            for part in re.split(r"[,;|/]", vals):
                t = part.strip()
                if len(t) > 1:
                    tokens.append(t)
        else:
            for part in re.split(r"[,;|/]", line):
                t = part.strip()
                if len(t) > 2:
                    tokens.append(t)
    seen = set()
    out = []
    for t in tokens:
        low = t.lower()
        if low not in seen:
            seen.add(low)
            out.append(t)
    return out


def _load_from_cache(resume_path: str) -> dict | None:
    if not os.path.exists(CACHE_JSON):
        return None
    try:
        if os.path.getmtime(CACHE_JSON) <= os.path.getmtime(resume_path):
            return None
        with open(CACHE_JSON, encoding="utf-8") as f:
            data = json.load(f)
        if data.get("file_path") == os.path.abspath(resume_path):
            return data
    except Exception:
        pass
    return None


def _save_cache(data: dict) -> None:
    with open(CACHE_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def load_resume(force: bool = False) -> dict:
    """
    Load and parse resume. Returns structured dict.
    Never falls back to synthetic skills block.
    """
    path = resolve_resume_path()
    if not path:
        return {
            "loaded": False,
            "file_path": "",
            "file_name": "",
            "full_text": "",
            "pages_parsed": 0,
            "sections": {},
            "skills": [],
            "skills_count": 0,
            "last_loaded_at": "",
            "char_count": 0,
            "error": "Resume file not found. Set APPLICANT_RESUME_PATH or place resume.pdf in resumes/.",
        }

    if not force:
        cached = _load_from_cache(path)
        if cached and cached.get("loaded"):
            return cached

    try:
        use_docx = path.lower().endswith(".docx")
        if use_docx:
            full_text, pages = _extract_docx_text(path)
        else:
            full_text, pages = _extract_pdf_text(path)

        if not full_text or len(full_text) < 100:
            return {
                "loaded": False,
                "file_path": path,
                "file_name": os.path.basename(path),
                "full_text": "",
                "pages_parsed": pages,
                "sections": {},
                "skills": [],
                "skills_count": 0,
                "last_loaded_at": datetime.now().isoformat(),
                "char_count": 0,
                "error": "Resume parsed but content too short — check the PDF.",
            }

        sections = _split_sections(full_text)
        skills = _extract_skill_tokens(sections.get("skills", ""))
        data = {
            "loaded": True,
            "file_path": path,
            "file_name": os.path.basename(path),
            "full_text": full_text,
            "pages_parsed": pages,
            "sections": sections,
            "skills": skills,
            "skills_count": len(skills),
            "last_loaded_at": datetime.now().isoformat(),
            "char_count": len(full_text),
            "error": "",
        }
        _save_cache(data)
        log.info(
            "Resume loaded: %s (%d pages, %d skills, %d chars)",
            data["file_name"], pages, len(skills), len(full_text),
        )
        return data
    except ImportError as e:
        return {
            "loaded": False,
            "file_path": path,
            "file_name": os.path.basename(path),
            "full_text": "",
            "pages_parsed": 0,
            "sections": {},
            "skills": [],
            "skills_count": 0,
            "last_loaded_at": "",
            "char_count": 0,
            "error": f"Missing library: {e}. Run: pip install pdfplumber",
        }
    except Exception as e:
        log.error("Resume parse error: %s", e)
        return {
            "loaded": False,
            "file_path": path,
            "file_name": os.path.basename(path),
            "full_text": "",
            "pages_parsed": 0,
            "sections": {},
            "skills": [],
            "skills_count": 0,
            "last_loaded_at": datetime.now().isoformat(),
            "char_count": 0,
            "error": str(e)[:200],
        }


def get_resume_status() -> dict:
    """Dashboard-friendly resume status."""
    return load_resume()


def get_resume_text() -> str:
    """Full resume text or empty string if not loaded."""
    data = load_resume()
    return data.get("full_text", "") if data.get("loaded") else ""


def get_resume_context_for_prompt(max_chars: int = 5000) -> str:
    """Structured resume context for OpenAI scoring and packet generation."""
    data = load_resume()
    if not data.get("loaded"):
        return ""
    sections = data.get("sections", {})
    parts = []
    for label, key in [
        ("PROFESSIONAL SUMMARY", "professional_summary"),
        ("TECHNICAL SKILLS", "skills"),
        ("PROFESSIONAL EXPERIENCE", "experience"),
        ("EDUCATION", "education"),
    ]:
        body = sections.get(key, "").strip()
        if body:
            parts.append(f"{label}:\n{body}")
    if not parts:
        return data.get("full_text", "")[:max_chars]
    text = "\n\n".join(parts)
    return text[:max_chars]


def extract_applicant_contact() -> dict:
    """Parse name, email, phone from resume header."""
    data = load_resume()
    text = data.get("full_text", "")
    contact = {"full_name": "", "email": "", "phone": ""}
    if not text:
        return contact
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if lines:
        name = lines[0].replace("•", "").strip()
        if len(name) < 60 and not "@" in name:
            contact["full_name"] = name.title() if name.isupper() else name
    header = " ".join(lines[:3])
    email_m = re.search(r"[\w.+-]+@[\w.-]+\.\w+", header)
    if email_m:
        contact["email"] = email_m.group(0)
    phone_m = re.search(r"(\+?\d[\d\s\-().]{8,}\d)", header)
    if phone_m:
        contact["phone"] = phone_m.group(1).strip()
    return contact


def analyze_keyword_gaps(job_text: str, top_n: int = 15) -> dict:
    """
    Compare job description keywords against resume skills.
    Returns missing and matched keyword lists.
    """
    data = load_resume()
    job_text = (job_text or "").lower()
    resume_skills = [s.lower() for s in data.get("skills", [])]
    full_text = (data.get("full_text") or "").lower()

    # Common tech keywords to check
    candidates = set()
    for skill in resume_skills:
        candidates.add(skill)
    gap_patterns = [
        r"\b(java|spring boot|spring|node\.?js|aws|lambda|microservices|rest api|"
        r"kubernetes|docker|python|tensorflow|pytorch|llm|rag|genai|langchain|"
        r"postgresql|oracle|mysql|oauth|ci/cd|jenkins|gradle|agile|scrum|"
        r"full stack|backend|api gateway|sqs|s3|machine learning|nlp)\b",
    ]
    job_keywords = set()
    for pat in gap_patterns:
        for m in re.finditer(pat, job_text, re.I):
            job_keywords.add(m.group(1).lower())

    matched = []
    missing = []
    for kw in sorted(job_keywords):
        if kw in full_text or any(kw in s for s in resume_skills):
            matched.append(kw)
        else:
            missing.append(kw)

    return {
        "matched": matched[:top_n],
        "missing": missing[:top_n],
        "match_rate": round(len(matched) / max(len(job_keywords), 1) * 100, 1),
    }
