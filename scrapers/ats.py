import httpx
import time
import random
import sys
import os
import logging
from datetime import datetime
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    from filters import ML_KEYWORDS, TITLE_BLOCK, JAVA_KEYWORDS
except Exception:
    ML_KEYWORDS = ["machine learning", "ml engineer", "ai engineer", "llm"]
    JAVA_KEYWORDS = ["java", "backend", "spring"]
    TITLE_BLOCK = []

log = logging.getLogger("alligator_apply")

try:
    from utils.us_filter import job_is_us, usa_only_enabled
except ImportError:
    job_is_us = lambda j: True
    usa_only_enabled = lambda: False

GREENHOUSE_COMPANIES = [
    "anthropic", "openai", "scaleai", "cohere", "langchain",
    "pinecone", "weaviate", "modal", "runway", "deepgram", "gradientai",
    "capitalone", "granular", "indigoag", "taranis",
    "elevenlabs", "polyai", "humeai", "vapi",
    "retool", "temporal", "glean",
    "arize-ai", "ada-support", "sierra",
    "decagon", "talkdesk", "salesforce",
    "twilio", "gong",
    "langfuse", "lindy", "cognigy",
    "n8n", "zapier", "factorial",
    "attio", "tinybird", "travelperk",
    "deepgram-2", "weights-biases", "cohere-2",
    "mistral", "pinecone-2", "modal-labs",
    "capital-one", "huggingface",
]

LEVER_COMPANIES = [
    "mistral", "together-ai", "togetherai", "replicate", "databricks",
    "wandb", "huggingface",
    "bland-ai", "speechmatics", "liveperson", "dialpad",
    "scale-ai", "modal-labs", "anyscale", "cohere",
]

ASHBY_COMPANIES = [
    "anthropic", "openai", "linear",
    "vercel", "retool", "notion",
    "figma", "rippling", "brex",
    "scale", "cohere", "together",
]

def is_relevant(job):
    title = job.get("title", "").lower()
    desc  = job.get("description", "").lower()
    text  = title + " " + desc
    for block in TITLE_BLOCK:
        if block in title:
            return False
    keywords = ML_KEYWORDS + JAVA_KEYWORDS
    return any(kw in text for kw in keywords)


def _greenhouse_location(job: dict) -> str:
    loc = job.get("location") or {}
    name = loc.get("name", "") if isinstance(loc, dict) else str(loc)
    offices = job.get("offices") or []
    if isinstance(offices, list) and offices:
        parts = []
        for o in offices:
            if isinstance(o, dict):
                parts.append(o.get("name") or o.get("location") or "")
        joined = ", ".join(p for p in parts if p)
        if joined:
            return joined
    return name or ""


def _lever_location(job: dict) -> str:
    cats = job.get("categories") or {}
    if isinstance(cats, dict):
        return cats.get("location", "") or ""
    return ""


def _ashby_location(job: dict) -> str:
    loc = job.get("location", "") or ""
    if job.get("isRemote"):
        return f"{loc} Remote US".strip()
    return loc


def _keep_us(candidate: dict) -> bool:
    if usa_only_enabled() and not job_is_us(candidate):
        return False
    return True


def scrape_greenhouse():
    results = []
    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            for slug in GREENHOUSE_COMPANIES:
                try:
                    time.sleep(random.uniform(1, 3))
                    url = f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"
                    r = client.get(url)
                    r.raise_for_status()
                    data = r.json()
                    for job in data.get("jobs", []):
                        title = job.get("title", "")
                        desc  = job.get("content", "") or ""
                        raw_date = job.get("updated_at", "") or ""
                        try:
                            date_posted = raw_date[:10]
                        except Exception:
                            date_posted = ""
                        candidate = {
                            "title":       title,
                            "company":     slug,
                            "url":         job.get("absolute_url", ""),
                            "source":      "greenhouse",
                            "description": desc[:2000],
                            "date_posted": date_posted,
                            "location":    _greenhouse_location(job),
                            "country":     "US",
                        }
                        if is_relevant(candidate) and _keep_us(candidate):
                            results.append(candidate)
                except Exception as e:
                    print(f"Greenhouse {slug} error: {e}")
    except Exception as e:
        print(f"Greenhouse client error: {e}")
    return results


def scrape_lever():
    results = []
    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            for company in LEVER_COMPANIES:
                try:
                    time.sleep(random.uniform(1, 3))
                    url = f"https://api.lever.co/v0/postings/{company}?mode=json"
                    r = client.get(url)
                    r.raise_for_status()
                    data = r.json()
                    for job in data:
                        title = job.get("text", "")
                        desc  = job.get("descriptionPlain", "") or job.get("description", "") or ""
                        ts = job.get("createdAt", 0) or 0
                        try:
                            date_posted = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                        except Exception:
                            date_posted = ""
                        candidate = {
                            "title":       title,
                            "company":     company,
                            "url":         job.get("hostedUrl", ""),
                            "source":      "lever",
                            "description": desc[:2000],
                            "date_posted": date_posted,
                            "location":    _lever_location(job),
                            "country":     "US",
                        }
                        if is_relevant(candidate) and _keep_us(candidate):
                            results.append(candidate)
                except Exception as e:
                    print(f"Lever {company} error: {e}")
    except Exception as e:
        print(f"Lever client error: {e}")
    return results


def scrape_ashby():
    jobs = []
    for company in ASHBY_COMPANIES:
        try:
            r = httpx.post(
                "https://api.ashbyhq.com/posting-api/job-board",
                json={"organizationHostedJobsPageName": company},
                timeout=10,
            )
            if not r.is_success:
                continue
            data = r.json()
            for job in data.get("jobs", []):
                title = job.get("title", "")
                if not any(
                    kw in title.lower()
                    for kw in ["ai", "ml", "engineer",
                               "machine learning", "llm"]
                ):
                    continue
                desc = job.get("descriptionPlain", title)[:500]
                location = _ashby_location(job)
                candidate = {
                    "title":       title,
                    "company":     company,
                    "url":         job.get("jobUrl", ""),
                    "source":      "ashby",
                    "description": desc,
                    "location":    location,
                    "country":     "US",
                }
                if _keep_us(candidate):
                    jobs.append(candidate)
            time.sleep(1)
        except Exception as e:
            log.error(f"Ashby {company}: {e}")
    log.info(f"Ashby: {len(jobs)} jobs")
    return jobs
