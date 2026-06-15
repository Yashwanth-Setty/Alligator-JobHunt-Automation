"""Right-side navigation for Alligator Apply dashboard."""
import streamlit as st

NAV_ITEMS = [
    ("job_hunt", "Job Hunt", "Search, filter, and auto-apply"),
    ("job_statistics", "Job Statistics", "Pipeline and analytics"),
    ("settings", "Settings", "Profile and preferences"),
]


def init_session_state() -> None:
    if "nav_page" not in st.session_state:
        st.session_state.nav_page = "job_hunt"
    if "dark_mode" not in st.session_state:
        st.session_state.dark_mode = False


def render_right_nav() -> str:
    """Render navigation in right column; return selected page key."""
    init_session_state()
    st.markdown(
        '<div class="alligator-nav">'
        '<div class="alligator-brand">Alligator <span>Apply</span></div>'
        '<h3>Navigation</h3></div>',
        unsafe_allow_html=True,
    )
    selected = st.session_state.nav_page
    for key, label, caption in NAV_ITEMS:
        if st.button(
            label,
            key=f"nav_{key}",
            use_container_width=True,
            type="primary" if selected == key else "secondary",
        ):
            st.session_state.nav_page = key
            selected = key
        st.caption(caption)
    st.markdown("---")
    st.caption("Semi-automated · Never auto-submits")
    return selected
