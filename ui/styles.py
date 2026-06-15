"""SaaS dashboard styling — right navigation, cards, badges."""

THEME_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Right-side navigation panel */
.alligator-nav {
    background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
    border-radius: 16px;
    padding: 1.25rem 1rem;
    min-height: 520px;
    box-shadow: 0 4px 24px rgba(15, 23, 42, 0.12);
}

.alligator-nav h3 {
    color: #94a3b8;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin: 0 0 1rem 0.5rem;
}

.alligator-brand {
    color: #f8fafc;
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 1.5rem;
    padding: 0 0.5rem;
}

.alligator-brand span {
    color: #22c55e;
}

/* Metric cards */
.metric-card {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 1rem 1.25rem;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.metric-card h4 {
    color: #64748b;
    font-size: 0.75rem;
    font-weight: 500;
    margin: 0 0 0.35rem 0;
    text-transform: uppercase;
    letter-spacing: 0.04em;
}

.metric-card .value {
    color: #0f172a;
    font-size: 1.75rem;
    font-weight: 700;
    line-height: 1.2;
}

/* Section headers */
.section-header {
    margin-bottom: 1.25rem;
}

.section-header h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: #0f172a;
    margin: 0;
}

.section-header p {
    color: #64748b;
    margin: 0.25rem 0 0 0;
    font-size: 0.9rem;
}

/* Resume upload card */
.resume-card {
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 12px;
    padding: 1.25rem;
    margin-bottom: 1rem;
}

/* Status badges */
.badge {
    display: inline-block;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 600;
}
.badge-green { background: #dcfce7; color: #166534; }
.badge-amber { background: #fef3c7; color: #92400e; }
.badge-red { background: #fee2e2; color: #991b1b; }
.badge-blue { background: #dbeafe; color: #1e40af; }
.badge-gray { background: #f1f5f9; color: #475569; }
.badge-purple { background: #ede9fe; color: #5b21b6; }

/* Manual review panel */
.manual-panel {
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 12px;
    padding: 1rem;
    margin-top: 1rem;
}

/* Dark theme overrides */
body.dark-theme .metric-card {
    background: #1e293b;
    border-color: #334155;
}
body.dark-theme .metric-card .value { color: #f1f5f9; }
body.dark-theme .section-header h1 { color: #f1f5f9; }
body.dark-theme .resume-card {
    background: #1e293b;
    border-color: #475569;
}

/* Hide default Streamlit header padding tweak */
.block-container { padding-top: 1.5rem; max-width: 1400px; }

@media (max-width: 768px) {
    .alligator-nav { min-height: auto; margin-bottom: 1rem; }
}
</style>
"""


def inject_styles(dark_mode: bool = False) -> None:
    import streamlit as st
    theme_class = "dark-theme" if dark_mode else ""
    st.markdown(THEME_CSS, unsafe_allow_html=True)
    if dark_mode:
        st.markdown(f'<script>document.body.classList.add("{theme_class}");</script>', unsafe_allow_html=True)


def status_badge_html(status: str) -> str:
    colors = {
        "found": "gray", "matched": "blue", "ready_to_apply": "green",
        "auto_applied": "green", "manual_pending": "amber", "applied": "green",
        "waiting": "blue", "recruiter_screen": "purple", "hr_round": "purple",
        "technical_interview": "purple", "final_interview": "purple",
        "offer": "green", "hired": "green", "rejected": "red", "failed": "red",
        "skipped": "gray",
        "GREEN": "green", "AMBER": "amber", "RED": "red",
    }
    cls = colors.get(status, "gray")
    label = status.replace("_", " ").title()
    return f'<span class="badge badge-{cls}">{label}</span>'


def metric_card_html(label: str, value: str | int) -> str:
    return f"""
    <div class="metric-card">
        <h4>{label}</h4>
        <div class="value">{value}</div>
    </div>
    """
