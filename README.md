# Alligator Job Hunt Automation

AI-powered job discovery, scoring, resume matching, and application workflow automation platform.

> **Semi-automated apply only** — generates application packets and autofills forms via Playwright. **Never auto-submits.** You review and submit manually.

---

## Features

- **Multi-source job scanning** — Greenhouse, Lever, Ashby, YC, Indeed, Google Jobs, Workday, SmartRecruiters, and more
- **USA-only filtering** — rejects non-US locations; CPT-safe visa answer templates
- **AI job scoring** — OpenAI-powered match scoring (GREEN / AMBER / RED tiers)
- **Resume-to-job matching** — parses your PDF resume; tailored summaries and bullets
- **Application packet generation** — cover letter, recruiter message, LinkedIn note, CPT-safe answers
- **Apply Agent (Playwright)** — autofills name, email, phone, resume; pauses before visa/salary/EEO/CAPTCHA
- **Streamlit dashboard** — pipeline tabs, analytics, diagnostics, launch controls
- **Deduplication** — canonical job keys, duplicate hiding, query bucket rotation
- **Automation workflows** — optional scheduler, Excel export, follow-up sentinel

---

## Screenshots

> Add screenshots of the dashboard here after running locally:
> - Need To Apply tab
> - Ready To Apply + Launch Apply
> - Diagnostics tab
> - Analytics

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Scrapers      │────▶│   main.py        │────▶│   jobs.db       │
│ (ATS, Indeed,   │     │  USA filter      │     │  (SQLite)       │
│  Workday, …)    │     │  Dedupe + Score  │     └────────┬────────┘
└─────────────────┘     └──────────────────┘              │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Playwright     │◀────│  dashboard.py    │◀────│  Packet Engine  │
│  Apply Agent    │     │  (Streamlit)     │     │  Resume Variants│
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

| Module | Purpose |
|--------|---------|
| `main.py` | Scrape → filter → dedupe → score → save |
| `dashboard.py` | Streamlit UI, pipeline management |
| `utils/apply_agent.py` | Playwright autofill (no auto-submit) |
| `utils/packet_service.py` | Application packet generation |
| `utils/resume_variants.py` | Role-specific resume tailoring |
| `scrapers/` | Job source connectors |
| `utils/us_filter.py` | USA location filtering |

---

## Installation

### Prerequisites

- Python 3.10+
- OpenAI API key
- Your resume as PDF

### Setup

```bash
git clone https://github.com/Yashwanth-Setty/Alligator-JobHunt-Automation.git
cd Alligator-JobHunt-Automation
pip install -r requirements.txt
playwright install chromium
```

### Environment

```bash
cp .env.example .env
```

Edit `.env` — minimum required:

```env
OPENAI_API_KEY=your_openai_key_here
APPLICANT_RESUME_PATH=./resumes/your_resume.pdf
APPLICANT_FULL_NAME=Your Full Name
APPLICANT_EMAIL=you@example.com
```

Place your resume PDF in `resumes/your_resume.pdf`.

---

## Usage

### Run a job scan

```bash
python main.py
```

### Launch dashboard

```bash
streamlit run dashboard.py
```

Open http://localhost:8501

### Application workflow

1. **Need To Apply** → **Generate Packet**
2. Job moves to **Ready To Apply**
3. **Launch Apply** → Playwright opens apply page, autofills safe fields
4. Complete visa/salary/EEO manually → submit yourself
5. **Mark Applied** in dashboard

### Test Playwright autofill

```bash
python launch_apply.py --test
```

---

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for scoring and packets |
| `APPLICANT_RESUME_PATH` | Yes | Path to your resume PDF |
| `APPLICANT_FULL_NAME` | Recommended | Used for form autofill |
| `APPLICANT_EMAIL` | Recommended | Used for form autofill |
| `USA_ONLY` | No | Default `true` — US jobs only |
| `APIFY_TOKEN_1` | No | LinkedIn scraping via Apify |
| `TAVILY_API_KEY` | No | Job liveness checks |

See `.env.example` for all options.

---

## Security

- **Never commit `.env`** — it is gitignored
- Personal resumes, logs, databases, and exports are excluded from the repository
- API keys are loaded from environment variables only
- Apply Agent never auto-submits applications

---

## Project structure

```
├── main.py                 # Job scan pipeline
├── dashboard.py            # Streamlit dashboard
├── launch_apply.py         # Playwright apply launcher
├── scrapers/               # Job source connectors
├── utils/                  # Scoring, packets, apply agent, filters
├── agents/                 # Scheduled agent wrappers
├── test_data/              # Local Playwright test form
├── resumes/                # Your resume (gitignored)
├── outputs/                # Generated packets (gitignored)
└── logs/                   # Runtime logs (gitignored)
```

---

## License

MIT License — see [LICENSE](LICENSE).

---

## Disclaimer

This tool assists with job search and application preparation. You are responsible for reviewing all generated content and submitting applications yourself. Do not misrepresent qualifications. Respect employer terms of service and applicable laws.
