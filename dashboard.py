"""Alligator Apply — modern dashboard with right-side navigation."""
import streamlit as st

import utils.env_loader  # noqa: F401
from ui.nav import render_right_nav
from ui.pages.job_hunt import render_job_hunt
from ui.pages.job_statistics import render_job_statistics
from ui.pages.settings import load_settings_on_start, render_settings
from ui.styles import inject_styles
from utils.application_service import ensure_synced
from utils.dashboard_core import load_jobs_df
from utils.db_schema import init_dashboard_schema
from utils.seed_mock_data import seed_mock_jobs_if_empty


@st.cache_data(ttl=20)
def cached_jobs():
    ensure_synced()
    return load_jobs_df()


def main() -> None:
    st.set_page_config(
        page_title="Alligator Apply",
        page_icon="🐊",
        layout="wide",
        initial_sidebar_state="collapsed",
    )

    init_dashboard_schema()
    load_settings_on_start()
    seed_mock_jobs_if_empty()
    inject_styles(dark_mode=st.session_state.get("dark_mode", False))

    # Layout: main content (left) + right navigation
    main_col, nav_col = st.columns([5, 1.15], gap="medium")

    with nav_col:
        page = render_right_nav()

    with main_col:
        if page == "job_hunt":
            render_job_hunt(cached_jobs)
        elif page == "job_statistics":
            render_job_statistics()
        else:
            render_settings()


if __name__ == "__main__":
    main()
