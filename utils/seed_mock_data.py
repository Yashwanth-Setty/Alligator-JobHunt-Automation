"""Seed sample jobs for UI development — no personal data."""
import hashlib
import os
import sqlite3
from datetime import datetime, timedelta

from utils.apply_db import get_connection
from utils.db_schema import init_dashboard_schema, sync_applications_from_jobs

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _jid(company: str, title: str) -> str:
    return hashlib.md5(f"{company}:{title}".encode()).hexdigest()


MOCK_JOBS = [
    {
        "company": "Acme Corp",
        "title": "Senior Software Engineer — Backend",
        "url": "https://boards.greenhouse.io/acme/jobs/1001",
        "source": "greenhouse",
        "score": 82,
        "location": "Remote (US)",
        "remote_type": "remote",
        "employment_type": "full_time",
        "experience_level": "senior",
        "visa_fit": "cpt_friendly",
    },
    {
        "company": "Nova Labs",
        "title": "Full Stack Developer",
        "url": "https://jobs.lever.co/novalabs/abc-123",
        "source": "lever",
        "score": 71,
        "location": "Austin, TX",
        "remote_type": "hybrid",
        "employment_type": "full_time",
        "experience_level": "mid",
        "visa_fit": "cpt_friendly",
    },
    {
        "company": "DataStream Inc",
        "title": "Machine Learning Engineer",
        "url": "https://example.wd5.myworkdayjobs.com/datastream/ml-eng",
        "source": "workday",
        "score": 68,
        "location": "Seattle, WA",
        "remote_type": "onsite",
        "employment_type": "full_time",
        "experience_level": "senior",
        "visa_fit": "sponsorship_unknown",
    },
    {
        "company": "CloudNine",
        "title": "Software Engineering Intern",
        "url": "https://jobs.ashbyhq.com/cloudnine/intern-2026",
        "source": "ashby",
        "score": 55,
        "location": "San Francisco, CA",
        "remote_type": "hybrid",
        "employment_type": "internship",
        "experience_level": "entry",
        "visa_fit": "cpt_friendly",
    },
    {
        "company": "FinEdge",
        "title": "Java Backend Contractor",
        "url": "https://boards.greenhouse.io/finedge/jobs/2002",
        "source": "greenhouse",
        "score": 77,
        "location": "Remote (US)",
        "remote_type": "remote",
        "employment_type": "contract",
        "experience_level": "mid",
        "visa_fit": "cpt_friendly",
    },
    {
        "company": "HealthTech Co",
        "title": "Platform Engineer",
        "url": "https://careers.smartrecruiters.com/healthtech/platform",
        "source": "smartrecruiters",
        "score": 63,
        "location": "Boston, MA",
        "remote_type": "onsite",
        "employment_type": "full_time",
        "experience_level": "mid",
        "visa_fit": "review",
    },
]


def seed_mock_jobs_if_empty() -> int:
    """Insert mock jobs when DB is empty or MOCK_DATA=true."""
    if os.environ.get("MOCK_DATA", "").lower() not in ("1", "true", "yes"):
        conn = get_connection()
        try:
            count = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
            if count > 0:
                return 0
        finally:
            conn.close()

    init_dashboard_schema()
    conn = get_connection()
    now = datetime.now().isoformat()
    inserted = 0
    try:
        for i, job in enumerate(MOCK_JOBS):
            jid = _jid(job["company"], job["title"])
            exists = conn.execute("SELECT 1 FROM jobs WHERE id=?", (jid,)).fetchone()
            if exists:
                continue
            posted = (datetime.now() - timedelta(days=i * 3)).strftime("%Y-%m-%d")
            eligible = 0 if "workday" in job["url"] else (1 if job["score"] >= 65 else 0)
            conn.execute(
                """
                INSERT INTO jobs (
                    id, company, title, url, source, score, seen_at, apply_status,
                    country, location_review, first_seen_at, last_seen_at, seen_count,
                    employment_type, remote_type, experience_level, date_posted,
                    visa_fit, auto_apply_eligible, pipeline_status
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    jid, job["company"], job["title"], job["url"], job["source"],
                    job["score"], now, "need_to_apply", "US", job["location"],
                    posted, now, 1, job["employment_type"], job["remote_type"],
                    job["experience_level"], posted, job["visa_fit"], eligible, "matched",
                ),
            )
            inserted += 1
        conn.commit()
    finally:
        conn.close()
    sync_applications_from_jobs()
    return inserted
