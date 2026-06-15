"""Job search filters for dashboard Job Hunt section."""
from datetime import datetime, timedelta

import pandas as pd


def apply_job_filters(df: pd.DataFrame, filters: dict) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()

    keywords = (filters.get("keywords") or "").strip().lower()
    if keywords:
        out = out[
            out["role"].str.lower().str.contains(keywords, na=False)
            | out["company"].str.lower().str.contains(keywords, na=False)
            | out.get("notes", pd.Series(dtype=str)).astype(str).str.lower().str.contains(keywords, na=False)
        ]

    location = (filters.get("location") or "").strip().lower()
    if location:
        out = out[out["location"].str.lower().str.contains(location, na=False)]

    remote_types = filters.get("remote_types") or []
    if remote_types:
        mask = pd.Series(False, index=out.index)
        for rt in remote_types:
            if rt == "remote":
                mask |= out["location"].str.lower().str.contains("remote", na=False)
            elif rt == "hybrid":
                mask |= out["location"].str.lower().str.contains("hybrid", na=False)
            elif rt == "onsite":
                mask |= ~out["location"].str.lower().str.contains("remote|hybrid", na=False, regex=True)
        out = out[mask]

    visa_filter = filters.get("visa_fit") or []
    if visa_filter:
        out = out[out.get("visa_fit", "unknown").isin(visa_filter) | out.get("visa_fit", "").eq("")]

    emp_types = filters.get("employment_types") or []
    if emp_types and "employment_type" in out.columns:
        out = out[out["employment_type"].fillna("").isin(emp_types) | out["employment_type"].isna()]

    exp_levels = filters.get("experience_levels") or []
    if exp_levels and "experience_level" in out.columns:
        out = out[out["experience_level"].fillna("").isin(exp_levels) | out["experience_level"].isna()]

    salary_min = filters.get("salary_min")
    salary_max = filters.get("salary_max")
    if salary_min and "salary_max" in out.columns:
        out = out[(out["salary_max"].fillna(0) >= salary_min) | out["salary_max"].isna()]
    if salary_max and "salary_min" in out.columns:
        out = out[(out["salary_min"].fillna(999999) <= salary_max) | out["salary_min"].isna()]

    date_posted = filters.get("date_posted_days")
    if date_posted and "first_seen_at" in out.columns:
        cutoff = (datetime.now() - timedelta(days=int(date_posted))).isoformat()
        out = out[out["first_seen_at"].fillna("").ge(cutoff)]

    company = (filters.get("company") or "").strip().lower()
    if company:
        out = out[out["company"].str.lower().str.contains(company, na=False)]

    sources = filters.get("sources") or []
    if sources:
        out = out[out["source"].isin(sources)]

    min_score = filters.get("min_score", 0)
    if min_score:
        out = out[out["match_score"] >= int(min_score)]

    tiers = filters.get("tiers") or []
    if tiers:
        out = out[out["tier"].isin(tiers)]

    pipeline = filters.get("pipeline_status") or []
    if pipeline and "pipeline_status" in out.columns:
        out = out[out["pipeline_status"].isin(pipeline)]

    return out


def enrich_jobs_with_applications(df: pd.DataFrame, applications: list[dict]) -> pd.DataFrame:
    if df.empty:
        return df
    app_map = {a["job_id"]: a for a in applications}
    rows = []
    for _, row in df.iterrows():
        r = row.to_dict()
        app = app_map.get(r["id"], {})
        r["pipeline_status"] = app.get("pipeline_status", r.get("status", "found"))
        r["visa_fit"] = app.get("visa_fit", r.get("visa_fit", "cpt_friendly"))
        r["auto_apply_eligible"] = bool(app.get("auto_apply_eligible", r.get("auto_apply_eligible", 0)))
        r["interview_stage"] = app.get("interview_stage", "")
        r["next_followup_date"] = app.get("next_followup_date", "")
        r["date_applied"] = app.get("date_applied", r.get("applied_at", ""))
        r["app_notes"] = app.get("notes", r.get("notes", ""))
        rows.append(r)
    return pd.DataFrame(rows)
