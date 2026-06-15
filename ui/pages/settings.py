"""Settings section — theme, mock data, environment hints."""
import os

import streamlit as st

from utils.application_service import get_user_setting, set_user_setting
from utils.diagnostics import get_diagnostics
from utils.resume_store import resume_status_summary
from utils.seed_mock_data import seed_mock_jobs_if_empty


def render_settings() -> None:
    st.markdown(
        '<div class="section-header"><h1>Settings</h1>'
        "<p>Preferences, diagnostics, and sample data.</p></div>",
        unsafe_allow_html=True,
    )

    st.subheader("Appearance")
    dark = st.toggle("Dark mode", value=st.session_state.get("dark_mode", False), key="settings_dark")
    if dark != st.session_state.get("dark_mode"):
        st.session_state.dark_mode = dark
        set_user_setting("dark_mode", "1" if dark else "0")
        st.rerun()

    st.subheader("Sample data")
    st.caption("Load demo jobs when the database is empty (no personal data).")
    if st.button("Load mock jobs", type="secondary"):
        os.environ["MOCK_DATA"] = "true"
        n = seed_mock_jobs_if_empty()
        st.cache_data.clear()
        st.success(f"Seeded {n} sample jobs") if n else st.info("Mock jobs already present or DB not empty")
        st.rerun()

    st.subheader("Resume")
    status = resume_status_summary()
    if status.get("loaded"):
        st.success(f"Active: {status.get('file_name')}")
        st.caption(f"Path: `{status.get('file_path', '')}` (local only, gitignored)")
    else:
        st.warning("No resume uploaded — use Job Hunt to upload.")

    st.subheader("Environment")
    st.code(
        "OPENAI_API_KEY=your_openai_key_here\n"
        "APPLICANT_RESUME_PATH=./resumes/your_resume.pdf\n"
        "MOCK_DATA=true  # optional demo jobs",
        language="bash",
    )
    st.caption("Copy `.env.example` to `.env` — never commit secrets.")

    st.subheader("Diagnostics")
    d = get_diagnostics()
    c1, c2 = st.columns(2)
    with c1:
        st.write(f"OpenAI key: **{'configured' if d['openai_key_loaded'] else 'missing'}**")
        st.write(f"Resume on disk: **{'yes' if d['resume_path_exists'] else 'no'}**")
        st.write(f"Playwright: **{'yes' if d['playwright_installed'] else 'no'}**")
    with c2:
        st.write(f"Jobs with URL: **{d['jobs_with_apply_url']}**")
        st.write(f"Eligible (≥65): **{d['jobs_eligible_for_packet']}**")
        st.write(f"Launch script: **{'yes' if d['launch_script_exists'] else 'no'}**")

    st.subheader("Auto-apply (placeholder)")
    st.info(
        "Full watsonx / enterprise auto-apply is not enabled. "
        "The Job Hunt page uses mock auto-apply that fills safe fields and "
        "pauses before visa, EEO, salary, CAPTCHA, and submit."
    )
    if st.button("Test Playwright form", key="settings_test_form"):
        from utils.mock_auto_apply import launch_apply_for_job
        ok, msg, errs = launch_apply_for_job("test", test_mode=True)
        st.success(msg) if ok else st.error(msg)
        for e in errs:
            st.warning(e)


def load_settings_on_start() -> None:
    dark = get_user_setting("dark_mode", "0") == "1"
    st.session_state.dark_mode = dark
