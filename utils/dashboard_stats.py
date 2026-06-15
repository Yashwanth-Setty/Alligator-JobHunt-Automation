"""Extended statistics for Job Statistics dashboard section."""
from collections import Counter
from datetime import datetime, timedelta

from utils.apply_db import get_connection
from utils.application_service import ensure_synced
from utils.db_schema import PIPELINE_STATUSES, init_dashboard_schema
from utils.dashboard_core import load_jobs_df, active_usa_jobs


def _conn():
    init_dashboard_schema()
    ensure_synced()
    return get_connection()


def compute_dashboard_stats() -> dict:
    df = load_jobs_df()
    base = active_usa_jobs(df) if not df.empty else df

    conn = _conn()
    try:
        apps = [dict(r) for r in conn.execute("SELECT * FROM applications").fetchall()]
        attempts = conn.execute(
            "SELECT status, COUNT(*) FROM auto_apply_attempts GROUP BY status"
        ).fetchall()
        manual_open = conn.execute(
            "SELECT COUNT(*) FROM manual_review_items WHERE status='open'"
        ).fetchone()[0]
    finally:
        conn.close()

    app_by_status = Counter(a.get("pipeline_status", "found") for a in apps)
    job_ids = set(base["id"]) if not base.empty else set()
    apps_for_jobs = [a for a in apps if a["job_id"] in job_ids] if job_ids else apps

    def count_status(*keys):
        return sum(app_by_status.get(k, 0) for k in keys)

    total_found = len(base) if not base.empty else len(df)
    matched = count_status("matched", "ready_to_apply", "auto_applied", "manual_pending",
                           "applied", "waiting", "recruiter_screen", "hr_round",
                           "technical_interview", "final_interview", "offer", "hired")
    if matched == 0 and not base.empty:
        matched = len(base[base["match_score"] >= 50])

    by_source = Counter()
    by_location = Counter()
    score_buckets = {"0-49": 0, "50-64": 0, "65-74": 0, "75-100": 0}
    apps_by_day: Counter = Counter()
    apps_by_week: Counter = Counter()

    if not base.empty:
        for _, row in base.iterrows():
            by_source[row.get("source") or "unknown"] += 1
            by_location[row.get("location") or "Unknown"] += 1
            s = int(row.get("match_score") or 0)
            if s < 50:
                score_buckets["0-49"] += 1
            elif s < 65:
                score_buckets["50-64"] += 1
            elif s < 75:
                score_buckets["65-74"] += 1
            else:
                score_buckets["75-100"] += 1

    week_ago = datetime.now() - timedelta(days=28)
    for a in apps_for_jobs:
        d = (a.get("date_applied") or a.get("updated_at") or "")[:10]
        if d:
            try:
                dt = datetime.strptime(d, "%Y-%m-%d")
                if dt >= week_ago:
                    apps_by_day[d] += 1
                    wk = dt.strftime("%Y-W%W")
                    apps_by_week[wk] += 1
            except ValueError:
                pass

    pipeline_counts = {s: app_by_status.get(s, 0) for s in PIPELINE_STATUSES}

    return {
        "cards": {
            "total_found": total_found,
            "jobs_matched": matched,
            "auto_applied": count_status("auto_applied"),
            "manual_pending": count_status("manual_pending") + int(manual_open),
            "applications_submitted": count_status("applied", "auto_applied", "waiting"),
            "waiting_review": count_status("waiting"),
            "recruiter_contacted": count_status("recruiter_screen"),
            "interview_scheduled": count_status(
                "hr_round", "technical_interview", "final_interview"
            ),
            "offer_hired": count_status("offer", "hired"),
            "rejected": count_status("rejected"),
            "failed_auto_apply": sum(c for st, c in attempts if st in ("failed", "paused")),
        },
        "pipeline_counts": pipeline_counts,
        "by_source": dict(by_source.most_common(12)),
        "by_location": dict(by_location.most_common(12)),
        "by_status_chart": dict(app_by_status),
        "score_distribution": score_buckets,
        "apps_by_day": dict(sorted(apps_by_day.items())),
        "apps_by_week": dict(sorted(apps_by_week.items())),
        "empty": total_found == 0 and len(apps) == 0,
    }


def load_applications_joined() -> list[dict]:
    ensure_synced()
    conn = _conn()
    try:
        rows = conn.execute(
            """
            SELECT a.*, j.company, j.title, j.url, j.source, j.score, j.location_review
            FROM applications a
            JOIN jobs j ON j.id = a.job_id
            ORDER BY j.score DESC
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
