# Alligator Apply

Full-stack job hunt automation dashboard — React + Node.js.

> **Streamlit is deprecated** for the main UI. Use this app instead.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React, Vite, Tailwind CSS, shadcn-style UI, Recharts, React Router |
| Backend | Node.js, Express, SQLite (better-sqlite3) |
| Automation | Playwright (placeholder), background workers, watsonx (placeholder) |

## Quick start

```bash
# 1. Environment
cp .env.example .env

# 2. Backend
cd backend
npm install
npm run dev

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev
```

- **Frontend:** http://localhost:5173
- **API:** http://localhost:4000/api/health

## Pages

1. **Job Hunt** — resume upload, filters, paginated jobs, background scan, mock auto-apply, manual review
2. **Job Statistics** — pipeline cards, Recharts, application table
3. **Settings** — profile, visa/location prefs, integration status

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET/POST/DELETE | `/api/resume` | Resume status, upload, delete |
| GET | `/api/jobs?page=&limit=` | Paginated jobs with filters |
| GET | `/api/jobs/scan/status` | Background scan progress |
| POST | `/api/jobs/scan` | Start job scan (non-blocking) |
| POST | `/api/jobs/seed` | Load mock_jobs.json |
| GET | `/api/applications/stats` | Dashboard statistics |
| GET | `/api/applications/pipeline` | Pipeline view |
| POST | `/api/auto-apply/batch` | Mock batch auto-apply |
| GET | `/api/auto-apply/manual-review` | Manual review queue |
| GET/PUT | `/api/settings` | User preferences |

## Safety defaults

- `AUTO_SUBMIT=false` — never auto-submit applications
- Pauses at visa, EEO, salary, CAPTCHA, and final submit
- Resumes and `.env` are gitignored

## Milestone 1 (current)

- [x] React dashboard with mock data
- [x] Express API + SQLite schema
- [x] Background scan status (mock)
- [x] Pagination
- [ ] Playwright integration
- [ ] watsonx agent reasoning
- [ ] Real job scan (Python bridge or Node scrapers)

## Legacy

The Python/Streamlit app remains in `../alligator_apply/` for reference but is not the primary dashboard.
