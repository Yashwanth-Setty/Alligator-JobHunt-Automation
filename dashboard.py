"""Alligator Apply — USA-only job pipeline dashboard."""
import json
from datetime import datetime

import pandas as pd
import streamlit as st

import utils.env_loader  # noqa: F401
from utils.analytics import compute_analytics
from utils.apply_db import (
    STATUS_APPLIED,
    STATUS_INTERVIEWING,
    STATUS_NEED_TO_APPLY,
    STATUS_READY_TO_APPLY,
    STATUS_REJECTED,
    STATUS_RECRUITER_CONTACTED,
    STATUS_SKIPPED,
    update_job,
)
from utils.apply_profile import get_apply_profile, profile_complete
from utils.dashboard_core import (
    VISA_DEFAULT,
    active_usa_jobs,
    generate_full_job_packet,
    launch_apply_browser,
    load_apply_session,
    load_jobs_df,
    mark_applied,
    move_to_need_to_apply,
    move_to_ready,
    needs_review_jobs,
    ready_to_apply_jobs,
    run_scan,
    set_job_status,
    skip_job,
    _is_need_to_apply,
)
from utils.diagnostics import get_diagnostics
from utils.gmail_sync import gmail_sync_enabled, sync_gmail_inbox
from utils.packet_service import PacketError, READY_MIN_SCORE
from resume_parser import get_resume_status, analyze_keyword_gaps, load_resume


def render_resume_status() -> None:
    status = get_resume_status()
    st.sidebar.markdown("---")
    st.sidebar.subheader("Resume Status")
    if status.get("loaded"):
        st.sidebar.success("✅ Resume Loaded")
        st.sidebar.caption(f"**File:** {status.get('file_name', '')}")
        st.sidebar.caption(f"**Pages:** {status.get('pages_parsed', 0)} · **Skills:** {status.get('skills_count', 0)}")
        st.sidebar.caption(f"**Last loaded:** {status.get('last_loaded_at', '')[:19]}")
    else:
        st.sidebar.error("❌ Resume Missing")
        st.sidebar.warning(status.get("error") or "Set APPLICANT_RESUME_PATH in .env")


def sidebar_filters(df: pd.DataFrame) -> pd.DataFrame:
    st.sidebar.header("Filters")
    min_score = st.sidebar.slider("Minimum Match %", 0, 100, 50)
    tiers = st.sidebar.multiselect("Tier", ["GREEN", "AMBER", "RED"], default=["GREEN", "AMBER"])
    sources = sorted(df["source"].dropna().unique().tolist()) if not df.empty else []
    selected_sources = st.sidebar.multiselect("Source", sources, default=sources) if sources else []
    q = st.sidebar.text_input("Search company or role", "").strip().lower()
    out = df[df["match_score"] >= min_score]
    if tiers:
        out = out[out["tier"].isin(tiers)]
    if selected_sources:
        out = out[out["source"].isin(selected_sources)]
    if q:
        out = out[
            out["company"].str.lower().str.contains(q, na=False)
            | out["role"].str.lower().str.contains(q, na=False)
        ]
    return out


def render_packet_status(row: pd.Series) -> None:
    ps = row.get("packet_status") or ("Generated" if row.get("application_packet") else "Missing")
    st.write(f"**Packet:** {'✅ Generated' if ps == 'Generated' else '❌ Missing'}")
    if row.get("packet_generated_at"):
        st.caption(f"Last generated: {row['packet_generated_at'][:19]}")
    if row.get("packet_md_path"):
        st.caption(f"Markdown: `{row['packet_md_path']}`")


def render_job_table(jobs: pd.DataFrame, show_packet: bool = False) -> None:
    if jobs.empty:
        st.info("No jobs in this view.")
        return
    cols = ["company", "role", "location", "match_score", "tier", "source", "status", "apply_url"]
    headers = ["Company", "Role", "Location", "Match %", "Tier", "Source", "Status", "Apply Link"]
    if show_packet:
        cols = ["company", "role", "match_score", "packet_status", "status", "apply_url"]
        headers = ["Company", "Role", "Match %", "Packet", "Status", "Apply Link"]
    table = jobs[cols].copy()
    table.columns = headers
    st.dataframe(
        table,
        use_container_width=True,
        hide_index=True,
        column_config={
            "Apply Link": st.column_config.LinkColumn("Apply Link", display_text="Apply →"),
            "Match %": st.column_config.NumberColumn(format="%d%%"),
        },
    )


def _show_packet_error(e: Exception) -> None:
    if isinstance(e, PacketError):
        st.error(str(e))
        for detail in e.details:
            st.warning(detail)
    else:
        st.error(f"Packet generation failed: {e}")


def render_need_apply_actions(row: pd.Series) -> None:
    jid = row["id"]
    notes_key = f"need_notes_{jid}"
    notes_val = st.text_area("Notes", value=row.get("notes") or "", key=notes_key, height=60)
    render_packet_status(row)

    packet = None
    if row.get("application_packet"):
        try:
            packet = json.loads(row["application_packet"])
        except Exception:
            packet = None
    if packet:
        with st.expander("View packet"):
            st.write(packet.get("why_match", ""))
            st.write(packet.get("cover_letter", ""))

    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        if st.button("Generate Packet", key=f"need_gen_{jid}"):
            with st.spinner("Generating…"):
                try:
                    result = generate_full_job_packet(row, move_to_ready=True)
                    st.success(f"Packet saved → Ready To Apply\n`{result['path']}`")
                    st.cache_data.clear()
                    st.rerun()
                except Exception as e:
                    _show_packet_error(e)
    with c2:
        if st.button("Move to Ready", key=f"need_ready_{jid}"):
            move_to_ready(jid, notes_val)
            st.cache_data.clear()
            st.rerun()
    with c3:
        if st.button("Launch Apply", key=f"need_launch_{jid}", type="primary"):
            ok, msg, errs = launch_apply_browser(jid)
            if ok:
                st.success(msg)
            else:
                st.error(msg)
                for er in errs:
                    st.warning(er)
    with c4:
        if st.button("Mark Applied", key=f"need_applied_{jid}"):
            mark_applied(jid, notes_val)
            st.cache_data.clear()
            st.rerun()
    with c5:
        if st.button("Skip", key=f"need_skip_{jid}"):
            skip_job(jid, notes_val)
            st.cache_data.clear()
            st.rerun()
    if row["apply_url"]:
        st.link_button("Open Apply Link", row["apply_url"], key=f"need_url_{jid}")


def render_ready_actions(row: pd.Series) -> None:
    jid = row["id"]
    notes_key = f"ready_notes_{jid}"
    notes_val = st.text_area("Notes", value=row.get("notes") or "", key=notes_key, height=60)
    render_packet_status(row)

    session = load_apply_session(jid)
    if session:
        st.info(f"Last launch: {session.get('status')} — filled: {', '.join(session.get('filled', [])) or 'none'}")

    c1, c2, c3, c4 = st.columns(4)
    with c1:
        if st.button("Regenerate Packet", key=f"ready_gen_{jid}"):
            with st.spinner("Regenerating…"):
                try:
                    result = generate_full_job_packet(row, move_to_ready=True)
                    st.success(f"Saved: `{result['path']}`")
                    st.cache_data.clear()
                    st.rerun()
                except Exception as e:
                    _show_packet_error(e)
    with c2:
        if st.button("Launch Apply", key=f"ready_launch_{jid}", type="primary"):
            ok, msg, errs = launch_apply_browser(jid)
            if ok:
                st.success(msg)
            else:
                st.error(msg)
                for er in errs:
                    st.warning(er)
    with c3:
        if st.button("Mark Applied", key=f"ready_applied_{jid}"):
            mark_applied(jid, notes_val)
            st.cache_data.clear()
            st.rerun()
    with c4:
        if st.button("Skip", key=f"ready_skip_{jid}"):
            skip_job(jid, notes_val)
            st.cache_data.clear()
            st.rerun()
    st.caption("Review and Submit manually — visa/salary/EEO/CAPTCHA are never autofilled.")


@st.cache_data(ttl=20)
def cached_jobs():
    return load_jobs_df()


def main():
    st.set_page_config(page_title="Alligator Apply", page_icon="🐊", layout="wide")
    st.title("🐊 Alligator Apply")
    st.caption("USA jobs only · Full-Time CPT · Never auto-submits")

    render_resume_status()
    resume = load_resume()
    if not resume.get("loaded"):
        st.error(f"❌ Resume Missing — {resume.get('error', 'Configure APPLICANT_RESUME_PATH')}")

    profile = get_apply_profile()
    prof_ok, prof_missing = profile_complete(profile)
    if not prof_ok:
        st.warning(f"Applicant profile incomplete: {', '.join(prof_missing)}")
        if profile.get("full_name") or profile.get("email"):
            st.caption(f"Using from resume: {profile.get('full_name')} · {profile.get('email')}")

    if st.button("Run New Scan", type="primary"):
        with st.spinner("Running python main.py …"):
            code, output = run_scan()
        st.cache_data.clear()
        st.success("Scan finished.") if code == 0 else st.error(f"Exit code {code}")
        with st.expander("Scan output"):
            st.code(output[-10000:] if len(output) > 10000 else output)
        st.rerun()

    all_jobs = cached_jobs()
    if all_jobs.empty:
        st.info("No jobs yet. Run a scan.")
        return

    base = active_usa_jobs(all_jobs)
    review = needs_review_jobs(all_jobs)
    filtered = sidebar_filters(base)

    today = datetime.now().strftime("%Y-%m-%d")
    need = filtered[filtered["status"].apply(_is_need_to_apply) & (filtered["status"] != STATUS_SKIPPED)]
    eligible = ready_to_apply_jobs(filtered)
    ready = eligible[eligible["status"] == STATUS_READY_TO_APPLY]
    ready_pool = eligible  # score >= 65 with URL
    applied = filtered[filtered["status"] == STATUS_APPLIED]
    recruiter = filtered[filtered["status"] == STATUS_RECRUITER_CONTACTED]
    interviewing = filtered[filtered["status"] == STATUS_INTERVIEWING]
    rejected = filtered[filtered["status"] == STATUS_REJECTED]
    applied_today = len(applied[applied["applied_at"].str.startswith(today, na=False)])
    dup_hidden = len(all_jobs[all_jobs["duplicate_of"].fillna("") != ""])

    m1, m2, m3, m4, m5, m6, m7 = st.columns(7)
    m1.metric("Need to Apply", len(need))
    m2.metric("Ready Pool (≥65)", len(ready_pool))
    m3.metric("Ready To Apply", len(ready))
    m4.metric("Applied today", applied_today)
    m5.metric("Total applied", len(applied))
    m6.metric("Duplicates hidden", dup_hidden)
    m7.metric("USA jobs", len(base))

    tabs = st.tabs([
        "Need To Apply", "Ready To Apply", "Applied", "Recruiter Contacted",
        "Interviewing", "Rejected", "Analytics", "Needs Review", "Diagnostics",
    ])

    with tabs[0]:
        st.subheader("Need To Apply")
        st.caption("Generate Packet → saves to DB + markdown → moves to Ready To Apply.")
        render_job_table(need, show_packet=True)
        for _, row in need.iterrows():
            with st.expander(f"{row['match_score']}% · {row['role'][:55]} @ {row['company']}"):
                render_need_apply_actions(row)

    with tabs[1]:
        st.subheader("Ready To Apply")
        st.caption(f"USA jobs score ≥ {READY_MIN_SCORE} with apply URL. Launch Apply opens Playwright — never auto-submits.")
        render_job_table(ready if not ready.empty else ready_pool, show_packet=True)
        for _, row in (ready if not ready.empty else ready_pool).iterrows():
            with st.expander(f"🚀 {row['match_score']}% · {row['role'][:55]} @ {row['company']}"):
                render_ready_actions(row)

    with tabs[2]:
        st.subheader("Applied")
        render_job_table(applied)

    with tabs[3]:
        st.subheader("Recruiter Contacted")
        render_job_table(recruiter)

    with tabs[4]:
        st.subheader("Interviewing")
        render_job_table(interviewing)

    with tabs[5]:
        st.subheader("Rejected")
        render_job_table(rejected)

    with tabs[6]:
        st.subheader("Analytics")
        stats = compute_analytics()
        if not stats.get("empty"):
            a1, a2, a3, a4 = st.columns(4)
            a1.metric("Response rate", f"{stats['response_rate']}%")
            a2.metric("Interview rate", f"{stats['interview_rate']}%")
            a3.metric("Rejection rate", f"{stats['rejection_rate']}%")
            a4.metric("Duplicate rate", f"{stats['duplicate_rate']}%")
            st.bar_chart(pd.Series(stats.get("jobs_by_source", {})))
            for rec in stats.get("recommendations", []):
                st.info(rec)

    with tabs[7]:
        st.subheader("Needs Review")
        render_job_table(review)
        for _, row in review.iterrows():
            with st.expander(f"{row['role'][:55]} @ {row['company']}"):
                if st.button("Confirm USA", key=f"usa_{row['id']}"):
                    update_job(row["id"], country="US", location_review=row["location"])
                    st.cache_data.clear()
                    st.rerun()

    with tabs[8]:
        st.subheader("Diagnostics")
        d = get_diagnostics()
        c1, c2 = st.columns(2)
        with c1:
            st.write(f"OpenAI key loaded: **{'yes' if d['openai_key_loaded'] else 'no'}**")
            st.write(f"Resume path exists: **{'yes' if d['resume_path_exists'] else 'no'}**")
            st.write(f"Applicant profile complete: **{'yes' if d['applicant_profile_complete'] else 'no'}**")
            if d["applicant_profile_missing"]:
                st.warning("Missing: " + ", ".join(d["applicant_profile_missing"]))
            st.write(f"Playwright installed: **{'yes' if d['playwright_installed'] else 'no'}**")
            st.write(f"Chromium installed: **{'yes' if d['chromium_installed'] else 'no'}**")
        with c2:
            st.write(f"Jobs with apply_url: **{d['jobs_with_apply_url']}**")
            st.write(f"Jobs eligible (≥{READY_MIN_SCORE}): **{d['jobs_eligible_for_packet']}**")
            st.write(f"Jobs ready_to_apply status: **{d['jobs_ready_to_apply']}**")
            st.write(f"Launch script: **{'yes' if d['launch_script_exists'] else 'no'}**")
            st.write(f"Test form: **{'yes' if d['test_form_exists'] else 'no'}**")
        if d["last_packet_error"]:
            st.error(f"Last packet error: {d['last_packet_error']}")
        if d["last_apply_error"]:
            st.error(f"Last apply launch error: {d['last_apply_error']}")
        if st.button("Run Playwright Test Form"):
            ok, msg, errs = launch_apply_browser("test", test_mode=True)
            st.success(msg) if ok else st.error(msg)
            for er in errs:
                st.warning(er)


if __name__ == "__main__":
    main()
