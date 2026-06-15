"""Job Hunt section — resume, filters, results, auto-apply, manual review."""
import pandas as pd
import streamlit as st

from utils.application_service import (
    ensure_synced,
    list_manual_review,
    resolve_manual_review,
    update_application,
)
from utils.dashboard_core import active_usa_jobs, load_jobs_df, run_scan
from utils.dashboard_stats import load_applications_joined
from utils.job_filters import apply_job_filters, enrich_jobs_with_applications
from utils.mock_auto_apply import (
    check_auto_apply_eligibility,
    launch_apply_for_job,
    mock_auto_apply_batch,
    mock_auto_apply_job,
)
from utils.resume_store import delete_active_resume, resume_status_summary, save_uploaded_resume
from ui.styles import status_badge_html


def _render_resume_upload() -> None:
    st.markdown('<div class="resume-card">', unsafe_allow_html=True)
    st.subheader("Resume")
    status = resume_status_summary()
    if status.get("loaded"):
        st.success(f"**{status.get('file_name', 'Resume')}** uploaded")
        if status.get("uploaded_at"):
            st.caption(f"Uploaded: {status['uploaded_at'][:19]}")
        elif status.get("source") == "env":
            st.caption("Loaded from APPLICANT_RESUME_PATH in .env")
        c1, c2 = st.columns(2)
        with c2:
            if st.button("Delete resume", key="del_resume"):
                delete_active_resume()
                st.cache_data.clear()
                st.rerun()
    else:
        st.warning(status.get("error", "No resume on file"))

    uploaded = st.file_uploader(
        "Upload resume (PDF or DOCX)",
        type=["pdf", "docx"],
        key="resume_uploader",
        help="Stored locally in resumes/ — never committed to git",
    )
    if uploaded:
        if st.button("Save resume", type="primary", key="save_resume"):
            try:
                save_uploaded_resume(uploaded.name, uploaded.getvalue())
                st.cache_data.clear()
                st.success(f"Saved {uploaded.name}")
                st.rerun()
            except ValueError as e:
                st.error(str(e))
    st.markdown("</div>", unsafe_allow_html=True)


def _render_filters(sources: list[str]) -> dict:
    with st.expander("Job Search Filters", expanded=True):
        c1, c2, c3 = st.columns(3)
        with c1:
            keywords = st.text_input("Job title / keywords", key="f_keywords")
            location = st.text_input("Location", key="f_location")
            company = st.text_input("Company", key="f_company")
        with c2:
            remote_types = st.multiselect(
                "Work mode",
                ["remote", "hybrid", "onsite"],
                default=[],
                key="f_remote",
            )
            visa_fit = st.multiselect(
                "Visa fit",
                ["cpt_friendly", "sponsorship_friendly", "sponsorship_unknown", "review"],
                default=[],
                key="f_visa",
            )
            emp = st.multiselect(
                "Employment type",
                ["full_time", "contract", "internship"],
                default=[],
                key="f_emp",
            )
        with c3:
            exp = st.multiselect(
                "Experience level",
                ["entry", "mid", "senior", "staff"],
                default=[],
                key="f_exp",
            )
            date_posted = st.selectbox(
                "Date posted",
                [None, 7, 14, 30, 90],
                format_func=lambda x: "Any" if x is None else f"Last {x} days",
                key="f_date",
            )
            sel_sources = st.multiselect("Source", sources, default=sources, key="f_src")

        c4, c5, c6 = st.columns(3)
        with c4:
            min_score = st.slider("Min match score", 0, 100, 50, key="f_score")
        with c5:
            sal_min = st.number_input("Salary min ($k)", 0, 500, 0, key="f_sal_min")
            sal_max = st.number_input("Salary max ($k)", 0, 500, 0, key="f_sal_max")
        with c6:
            tiers = st.multiselect("Tier", ["GREEN", "AMBER", "RED"], default=["GREEN", "AMBER"], key="f_tier")

    return {
        "keywords": keywords,
        "location": location,
        "company": company,
        "remote_types": remote_types,
        "visa_fit": visa_fit,
        "employment_types": emp,
        "experience_levels": exp,
        "date_posted_days": date_posted,
        "sources": sel_sources,
        "min_score": min_score,
        "salary_min": sal_min * 1000 if sal_min else None,
        "salary_max": sal_max * 1000 if sal_max else None,
        "tiers": tiers,
    }


def _eligible_label(job: dict) -> str:
    ok, reason = check_auto_apply_eligibility(job)
    return "Yes" if ok else f"No — {reason}"


def render_job_hunt(cached_jobs_fn) -> None:
    st.markdown(
        '<div class="section-header"><h1>Job Hunt</h1>'
        "<p>Upload your resume, search jobs, filter matches, and run auto-apply.</p></div>",
        unsafe_allow_html=True,
    )

    _render_resume_upload()

    c_scan, c_auto = st.columns([1, 2])
    with c_scan:
        if st.button("Run Job Scan", type="secondary", use_container_width=True):
            with st.spinner("Scanning job sources…"):
                code, output = run_scan()
            st.cache_data.clear()
            if code == 0:
                st.success("Scan complete")
            else:
                st.error(f"Scan exited with code {code}")
            with st.expander("Scan log"):
                st.code(output[-8000:] if len(output) > 8000 else output)
            st.rerun()

    ensure_synced()
    all_jobs = cached_jobs_fn()
    if all_jobs.empty:
        st.info("No jobs yet. Run a scan or enable mock data (see Settings).")
        return

    base = active_usa_jobs(all_jobs)
    apps = load_applications_joined()
    enriched = enrich_jobs_with_applications(base, apps)
    sources = sorted(enriched["source"].dropna().unique().tolist()) if not enriched.empty else []
    filters = _render_filters(sources)
    filtered = apply_job_filters(enriched, filters)

    with c_auto:
        eligible_count = sum(
            1 for _, r in filtered.iterrows() if check_auto_apply_eligibility(r.to_dict())[0]
        )
        st.metric("Eligible for auto-apply", eligible_count)
        if st.button(
            "Auto Apply Eligible Jobs",
            type="primary",
            use_container_width=True,
            disabled=eligible_count == 0,
        ):
            eligible_jobs = [
                r.to_dict() for _, r in filtered.iterrows()
                if check_auto_apply_eligibility(r.to_dict())[0]
            ]
            with st.spinner(f"Mock auto-apply on {len(eligible_jobs)} jobs…"):
                result = mock_auto_apply_batch(eligible_jobs)
            st.cache_data.clear()
            st.success(
                f"Auto-applied: {result['applied']} · "
                f"Manual review: {result['manual']} · Skipped: {result['skipped']}"
            )
            st.caption("Pauses at visa, EEO, salary, CAPTCHA, and final submit — never auto-submits.")
            st.rerun()

    st.subheader("Job Results")
    if filtered.empty:
        st.info("No jobs match your filters.")
    else:
        display = filtered.copy()
        display["visa_fit"] = display.get("visa_fit", "unknown")
        display["auto_eligible"] = display.apply(
            lambda r: "Yes" if check_auto_apply_eligibility(r.to_dict())[0] else "No",
            axis=1,
        )
        display["status"] = display.get("pipeline_status", display.get("status", ""))
        cols = [
            "role", "company", "location", "match_score", "visa_fit",
            "auto_eligible", "status", "apply_url", "id",
        ]
        headers = {
            "role": "Job Title",
            "company": "Company",
            "location": "Location",
            "match_score": "Match %",
            "visa_fit": "Visa Fit",
            "auto_eligible": "Auto-Apply",
            "status": "Status",
            "apply_url": "Apply Link",
            "id": "ID",
        }
        table = display[[c for c in cols if c in display.columns]].rename(columns=headers)
        st.dataframe(
            table.drop(columns=["ID"]),
            use_container_width=True,
            hide_index=True,
            column_config={
                "Apply Link": st.column_config.LinkColumn("Apply Link", display_text="Open →"),
                "Match %": st.column_config.NumberColumn(format="%d"),
            },
        )

        st.markdown("##### Actions")
        for _, row in filtered.head(20).iterrows():
            jid = row["id"]
            with st.expander(f"{row['match_score']}% · {row['role'][:50]} @ {row['company']}"):
                st.markdown(status_badge_html(row.get("pipeline_status", "")), unsafe_allow_html=True)
                notes = st.text_area("Notes", value=row.get("app_notes") or row.get("notes") or "", key=f"notes_{jid}")
                fc1, fc2, fc3 = st.columns(3)
                with fc1:
                    if st.button("Mock Auto Apply", key=f"auto_{jid}"):
                        out = mock_auto_apply_job(jid, row.to_dict())
                        st.cache_data.clear()
                        st.info(out["message"])
                        st.rerun()
                with fc2:
                    if st.button("Launch Browser", key=f"launch_{jid}"):
                        ok, msg, errs = launch_apply_for_job(jid)
                        st.success(msg) if ok else st.error(msg)
                        for e in errs:
                            st.warning(e)
                with fc3:
                    if st.button("Mark Applied", key=f"applied_{jid}"):
                        update_application(jid, pipeline_status="applied", notes=notes)
                        st.cache_data.clear()
                        st.rerun()

    _render_manual_review()


def _render_manual_review() -> None:
    st.markdown('<div class="manual-panel">', unsafe_allow_html=True)
    st.subheader("Manual Apply Required")
    st.caption("Jobs that failed auto-apply or need human action.")
    items = list_manual_review(open_only=True)
    if not items:
        st.info("No jobs in manual review.")
        st.markdown("</div>", unsafe_allow_html=True)
        return

    for item in items:
        jid = item["job_id"]
        reason = (item.get("reason") or "unknown").replace("_", " ").title()
        with st.container(border=True):
            st.write(f"**{item.get('title', '')}** @ {item.get('company', '')}")
            st.warning(f"Reason: {reason}")
            if item.get("details"):
                st.caption(item["details"])
            b1, b2, b3, b4 = st.columns(4)
            with b1:
                if item.get("url"):
                    st.link_button("Open Apply Page", item["url"], key=f"mr_url_{jid}")
            with b2:
                if st.button("Mark Applied", key=f"mr_applied_{jid}"):
                    update_application(jid, pipeline_status="applied")
                    resolve_manual_review(item["id"])
                    st.cache_data.clear()
                    st.rerun()
            with b3:
                if st.button("Skip", key=f"mr_skip_{jid}"):
                    update_application(jid, pipeline_status="skipped")
                    resolve_manual_review(item["id"])
                    st.cache_data.clear()
                    st.rerun()
            with b4:
                if st.button("Retry Auto Apply", key=f"mr_retry_{jid}"):
                    job = {
                        "id": jid,
                        "match_score": item.get("score"),
                        "apply_url": item.get("url"),
                        "auto_apply_eligible": 1,
                    }
                    out = mock_auto_apply_job(jid, job)
                    st.info(out["message"])
                    st.cache_data.clear()
                    st.rerun()
    st.markdown("</div>", unsafe_allow_html=True)
