"""Auto Apply Queue tab — assist only, no automatic submission."""
import os
from datetime import datetime

import streamlit as st

from utils.apply_db import (
    APPLY_APPLIED,
    APPLY_PACKET_READY,
    APPLY_PENDING,
    APPLY_SKIPPED,
    fetch_green_queue,
    fetch_job,
    update_job,
)
from utils.application_packets import generate_and_save_packet, packet_path

PACKETS_DIR = os.path.join(
    os.path.abspath(os.path.dirname(__file__)),
    "outputs",
    "application_packets",
)


def _status_label(status: str | None) -> str:
    if not status or status == APPLY_PENDING:
        return "Not applied"
    if status == APPLY_PACKET_READY:
        return "Packet ready"
    if status == APPLY_APPLIED:
        return "Applied"
    if status == APPLY_SKIPPED:
        return "Skipped"
    return status


def render_auto_apply_queue() -> None:
    st.subheader("Auto Apply Queue")
    st.caption(
        "GREEN matches only · Packets assist your application — "
        "**nothing is submitted automatically**. "
        "Confirm all visa answers manually before applying."
    )

    f1, f2, f3, f4, f5 = st.columns(5)
    with f1:
        green_only = st.checkbox("GREEN only", value=True, key="aq_green")
    with f2:
        show_not_applied = st.checkbox("Not applied", value=True, key="aq_not_applied")
    with f3:
        show_packet_ready = st.checkbox("Packet ready", value=True, key="aq_packet")
    with f4:
        show_applied = st.checkbox("Applied", value=False, key="aq_applied")
    with f5:
        show_skipped = st.checkbox("Skipped", value=False, key="aq_skipped")

    jobs = fetch_green_queue(green_only=green_only)
    if not jobs:
        st.info("No GREEN jobs (75%+ match) in the database yet. Run a scan first.")
        return

    def _include(job: dict) -> bool:
        st_val = job.get("apply_status") or APPLY_PENDING
        if st_val in (APPLY_PENDING, "", None) and show_not_applied:
            return True
        if st_val == APPLY_PACKET_READY and show_packet_ready:
            return True
        if st_val == APPLY_APPLIED and show_applied:
            return True
        if st_val == APPLY_SKIPPED and show_skipped:
            return True
        return False

    filtered = [j for j in jobs if _include(j)]
    if not filtered:
        st.warning("No jobs match the current status filters.")
        return

    labels = [
        f"{j.get('score', 0)}% · {j.get('title', '?')[:50]} @ {j.get('company', '?')} "
        f"[{_status_label(j.get('apply_status'))}]"
        for j in filtered
    ]
    idx = st.selectbox(
        "Select job",
        range(len(filtered)),
        format_func=lambda i: labels[i],
        key="aq_select_job",
    )
    job = filtered[idx]
    job_id = job["id"]

    c1, c2, c3, c4, c5 = st.columns(5)
    with c1:
        if st.button("Generate Packet", type="primary", key=f"gen_{job_id}"):
            with st.spinner("Generating application packet…"):
                try:
                    path = generate_and_save_packet(job)
                    update_job(
                        job_id,
                        apply_status=APPLY_PACKET_READY,
                        packet_generated_at=datetime.now().isoformat(),
                    )
                    st.success(f"Packet saved: `{path}`")
                    st.cache_data.clear()
                    st.rerun()
                except Exception as e:
                    st.error(f"Generation failed: {e}")

    url = job.get("url") or ""
    with c2:
        if url:
            st.link_button("Open Apply Link", url, use_container_width=True)
        else:
            st.button("Open Apply Link", disabled=True, help="No URL on file")

    with c3:
        if st.button("Mark Applied", key=f"applied_{job_id}"):
            update_job(
                job_id,
                apply_status=APPLY_APPLIED,
                applied_at=datetime.now().isoformat(),
            )
            st.cache_data.clear()
            st.rerun()

    with c4:
        if st.button("Skip", key=f"skip_{job_id}"):
            update_job(job_id, apply_status=APPLY_SKIPPED)
            st.cache_data.clear()
            st.rerun()

    st.markdown(
        f"**{job.get('title')}** @ **{job.get('company')}** · "
        f"{job.get('score')}% · Source: {job.get('source')} · "
        f"Status: {_status_label(job.get('apply_status'))}"
    )

    notes_key = f"notes_{job_id}"
    st.text_area(
        "Notes",
        value=job.get("notes") or "",
        height=100,
        key=notes_key,
        placeholder="Interview notes, recruiter contact, custom salary target…",
    )
    if st.button("Save Notes", key=f"save_notes_{job_id}"):
        update_job(job_id, notes=st.session_state.get(notes_key, ""))
        st.success("Notes saved.")
        st.cache_data.clear()

    path = packet_path(job.get("company", ""), job.get("title", ""))
    if os.path.exists(path):
        st.markdown("#### Application packet preview")
        with open(path, encoding="utf-8") as f:
            st.markdown(f.read())
        with open(path, encoding="utf-8") as f:
            st.download_button(
                "Download packet (.md)",
                data=f.read(),
                file_name=os.path.basename(path),
                mime="text/markdown",
                key=f"dl_{job_id}",
            )
    elif job.get("apply_status") == APPLY_PACKET_READY:
        st.warning("Packet marked ready but file not found. Click **Generate Packet** again.")

    st.divider()
    st.markdown("#### Queue overview")
    overview = [
        {
            "Match %": j.get("score"),
            "Company": j.get("company"),
            "Title": (j.get("title") or "")[:60],
            "Status": _status_label(j.get("apply_status")),
            "Packet": "Yes" if j.get("packet_generated_at") else "No",
        }
        for j in filtered
    ]
    st.dataframe(overview, use_container_width=True, hide_index=True)
