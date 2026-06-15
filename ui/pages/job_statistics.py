"""Job Statistics section — cards, charts, pipeline."""
import pandas as pd
import streamlit as st

from utils.application_service import ensure_synced, update_application
from utils.dashboard_stats import compute_dashboard_stats, load_applications_joined
from utils.db_schema import PIPELINE_STATUSES, INTERVIEW_STAGES
from ui.styles import metric_card_html, status_badge_html


def _render_cards(stats: dict) -> None:
    cards = stats.get("cards", {})
    items = [
        ("Total Jobs Found", cards.get("total_found", 0)),
        ("Jobs Matched", cards.get("jobs_matched", 0)),
        ("Auto-Applied", cards.get("auto_applied", 0)),
        ("Manual Pending", cards.get("manual_pending", 0)),
        ("Submitted", cards.get("applications_submitted", 0)),
        ("Waiting / Review", cards.get("waiting_review", 0)),
        ("Recruiter Contacted", cards.get("recruiter_contacted", 0)),
        ("Interviews", cards.get("interview_scheduled", 0)),
        ("Offer / Hired", cards.get("offer_hired", 0)),
        ("Rejected", cards.get("rejected", 0)),
        ("Failed Auto-Apply", cards.get("failed_auto_apply", 0)),
    ]
    row1 = st.columns(4)
    row2 = st.columns(4)
    row3 = st.columns(3)
    for i, (label, val) in enumerate(items):
        col = (row1 + row2 + row3)[i]
        with col:
            st.markdown(metric_card_html(label, val), unsafe_allow_html=True)


def _render_charts(stats: dict) -> None:
    st.subheader("Charts")
    c1, c2 = st.columns(2)
    with c1:
        st.markdown("**Applications by status**")
        by_status = stats.get("by_status_chart", {})
        if by_status:
            st.bar_chart(pd.Series(by_status))
        else:
            st.caption("No data yet")
    with c2:
        st.markdown("**Applications by source**")
        by_src = stats.get("by_source", {})
        if by_src:
            st.bar_chart(pd.Series(by_src))
        else:
            st.caption("No data yet")

    c3, c4 = st.columns(2)
    with c3:
        st.markdown("**Applications by location**")
        by_loc = stats.get("by_location", {})
        if by_loc:
            st.bar_chart(pd.Series(by_loc))
    with c4:
        st.markdown("**Match score distribution**")
        scores = stats.get("score_distribution", {})
        if scores:
            st.bar_chart(pd.Series(scores))

    st.markdown("**Applications by day**")
    by_day = stats.get("apps_by_day", {})
    if by_day:
        st.line_chart(pd.Series(by_day))
    else:
        st.caption("Apply to jobs to see daily trends.")


def _render_pipeline_editor() -> None:
    st.subheader("Application Status Pipeline")
    st.caption("Update status, notes, dates, and interview stage per job.")
    apps = load_applications_joined()
    if not apps:
        st.info("No applications tracked yet.")
        return

    for app in apps[:25]:
        jid = app["job_id"]
        with st.expander(f"{app.get('score', 0)}% · {app.get('title', '')} @ {app.get('company', '')}"):
            st.markdown(
                status_badge_html(app.get("pipeline_status", "found")),
                unsafe_allow_html=True,
            )
            c1, c2, c3 = st.columns(3)
            with c1:
                status = st.selectbox(
                    "Status",
                    PIPELINE_STATUSES,
                    index=PIPELINE_STATUSES.index(app.get("pipeline_status", "found"))
                    if app.get("pipeline_status") in PIPELINE_STATUSES else 0,
                    key=f"pipe_status_{jid}",
                )
            with c2:
                stage = st.selectbox(
                    "Interview stage",
                    INTERVIEW_STAGES,
                    index=INTERVIEW_STAGES.index(app.get("interview_stage") or "")
                    if (app.get("interview_stage") or "") in INTERVIEW_STAGES else 0,
                    key=f"pipe_stage_{jid}",
                )
            with c3:
                from datetime import datetime as _dt
                existing_fu = (app.get("next_followup_date") or "")[:10]
                fu_default = _dt.strptime(existing_fu, "%Y-%m-%d").date() if existing_fu else None
                followup = st.date_input(
                    "Next follow-up",
                    value=fu_default,
                    key=f"pipe_follow_{jid}",
                )
            notes = st.text_area("Notes", value=app.get("notes") or "", key=f"pipe_notes_{jid}")
            applied = st.text_input(
                "Date applied (YYYY-MM-DD)",
                value=(app.get("date_applied") or "")[:10],
                key=f"pipe_applied_{jid}",
            )
            if st.button("Save", key=f"pipe_save_{jid}"):
                update_application(
                    jid,
                    pipeline_status=status,
                    notes=notes,
                    interview_stage=stage,
                    date_applied=applied or None,
                    next_followup_date=followup.isoformat() if followup else None,
                )
                st.cache_data.clear()
                st.success("Saved")
                st.rerun()


def render_job_statistics() -> None:
    st.markdown(
        '<div class="section-header"><h1>Job Statistics</h1>'
        "<p>Track applications, pipeline progress, and hiring outcomes.</p></div>",
        unsafe_allow_html=True,
    )
    ensure_synced()
    stats = compute_dashboard_stats()
    if stats.get("empty"):
        st.info("Run a job scan to populate statistics.")

    _render_cards(stats)
    st.divider()
    _render_charts(stats)
    st.divider()
    _render_pipeline_editor()
