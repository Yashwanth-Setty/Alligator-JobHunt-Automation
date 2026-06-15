"""Pipeline analytics and recommendations."""
import os
import sqlite3
from collections import Counter
from datetime import datetime, timedelta

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DB_PATH = os.path.join(BASE, "jobs.db")

STATUS_APPLIED = "applied"
STATUS_INTERVIEWING = "interviewing"
STATUS_REJECTED = "rejected"
STATUS_RECRUITER = "recruiter_contacted"


def _conn() -> sqlite3.Connection:
    return sqlite3.connect(DB_PATH, timeout=15)


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def compute_analytics() -> dict:
    conn = _conn()
    try:
        rows = conn.execute(
            "SELECT id, company, title, source, score, apply_status, applied_at, "
            "seen_at, first_seen_at, seen_count, duplicate_of, role_category, resume_variant "
            "FROM jobs"
        ).fetchall()
    finally:
        conn.close()

    if not rows:
        return {"empty": True}

    today = _today()
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    applied = [r for r in rows if r[5] == STATUS_APPLIED]
    interviewing = [r for r in rows if r[5] == STATUS_INTERVIEWING]
    rejected = [r for r in rows if r[5] == STATUS_REJECTED]
    recruiter = [r for r in rows if r[5] == STATUS_RECRUITER]
    applied_today = [r for r in applied if (r[6] or "").startswith(today)]

    total_applied = len(applied)
    total_interviews = len(interviewing)
    total_rejected = len(rejected)
    total_recruiter = len(recruiter)

    response_rate = round((total_recruiter + total_interviews) / max(total_applied, 1) * 100, 1)
    rejection_rate = round(total_rejected / max(total_applied, 1) * 100, 1)
    interview_rate = round(total_interviews / max(total_applied, 1) * 100, 1)

    # Applications per day (last 7 days)
    apps_by_day = Counter()
    for r in applied:
        d = (r[6] or r[7] or "")[:10]
        if d >= week_ago:
            apps_by_day[d] += 1

    # Discovered by source
    by_source = Counter(r[3] for r in rows if not (r[10] or ""))
    dup_rate = round(
        sum(1 for r in rows if (r[9] or 0) > 1 or (r[10] or "")) / max(len(rows), 1) * 100, 1
    )

    green = sum(1 for r in rows if (r[4] or 0) >= 75)
    amber = sum(1 for r in rows if 50 <= (r[4] or 0) < 75)

    # Best role category
    role_cats = Counter(r[11] for r in applied if r[11])
    source_applied = Counter(r[3] for r in applied)
    source_interviews = Counter(r[3] for r in interviewing)

    best_role = role_cats.most_common(1)[0][0] if role_cats else "N/A"
    best_source = source_applied.most_common(1)[0][0] if source_applied else "N/A"
    best_interview_source = source_interviews.most_common(1)[0][0] if source_interviews else "N/A"

    recommendations = []
    if role_cats.get("backend_java", 0) >= role_cats.get("ai_software", 0):
        recommendations.append("Apply more to Java Backend — strongest category volume.")
    else:
        recommendations.append("AI roles have lower response — prioritize Java Backend where possible.")

    if best_interview_source != "N/A":
        recommendations.append(f"{best_interview_source} source produced most interviews.")
    elif best_source != "N/A":
        recommendations.append(f"{best_source} source produced most applications.")

    if dup_rate > 30:
        recommendations.append(f"Duplicate rate is {dup_rate}% — dedupe is working; rotate search buckets.")

    if interview_rate < 5 and total_applied > 5:
        recommendations.append("Interview rate is low — refine GREEN matches and personalize outreach.")

    return {
        "empty": False,
        "applications_today": len(applied_today),
        "applications_per_day": dict(sorted(apps_by_day.items())),
        "total_applied": total_applied,
        "total_interviewing": total_interviews,
        "total_rejected": total_rejected,
        "total_recruiter_contacted": total_recruiter,
        "response_rate": response_rate,
        "rejection_rate": rejection_rate,
        "interview_rate": interview_rate,
        "green_count": green,
        "amber_count": amber,
        "jobs_by_source": dict(by_source.most_common(15)),
        "duplicate_rate": dup_rate,
        "best_role_category": best_role,
        "best_source": best_source,
        "best_interview_source": best_interview_source,
        "recommendations": recommendations,
    }
