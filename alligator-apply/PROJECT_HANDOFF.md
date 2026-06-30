# Alligator Apply — Project Handoff

> Generated for handoff from Cursor to Claude Code / Cowork.  
> Repository root: `alligator_apply/alligator-apply/`  
> Last inspected: June 2026

---

# 1. Project Overview

## Project name
**Alligator Apply**

## Purpose
AI-assisted job hunt dashboard: upload a resume, scan live ATS job boards, score fit against resume skills, rank results by search intent, generate application packets, track applications in a CRM, and get Career Copilot guidance. Built as a portfolio/demo stack (React + Node.js + SQLite) with explicit safety defaults — **never auto-submits applications**.

## Current development status
- **Active branch:** `main` (tracks `origin/main`)
- **Large local delta:** Many backend/frontend files are modified or untracked and **not committed** (see §15 Git). The working tree contains substantially more functionality than the last pushed commit (`14fd5c1`).
- **Runtime mode:** `.env` has `MOCK_MODE=false` (live scans). Backend on port 4000, frontend on port 5173.
- **Recent work:** Scan diagnostics, permissive early filtering, scan-result scoping (`scanRunId`), search-intent ranking, company registry, Workday adapter.

## Main features completed
| Feature | Status |
|---------|--------|
| React dashboard + routing | Done |
| Resume upload + PDF/DOCX parsing | Done |
| Live ATS scan (Greenhouse, Lever, Ashby, SmartRecruiters, Workday) | Done |
| Mock mode (`mock_jobs.json`) | Done |
| Company Registry (Settings UI + API) | Done |
| Resume-based match scoring | Done |
| Search-intent ranking (list-time, no hard keyword filter) | Done |
| Scan run scoping (`scan_run_id`) | Done |
| Partial results during scan | Done |
| Application packet generation (template) | Done |
| Career Copilot (template) | Done |
| Applications CRM (Kanban + table) | Done |
| Scan diagnostics + provider debug scripts | Done |
| Capabilities manifest (`GET /api/capabilities`) | Done |

## Features partially completed
| Feature | Status |
|---------|--------|
| Auto-apply (Playwright) | Placeholder; pauses before submit; disabled in mock mode |
| watsonx LLM agent | Credentials detected; falls back to template agent |
| OpenAI integration | Key in `.env`; unused by this stack |
| Standalone scan worker | `backend/src/workers/jobScanWorker.js` — stub entry point |
| Additional ATS stubs | BambooHR, iCIMS, Jobvite, JazzHR, Teamtailor — registered but not fully implemented |
| Screenshots / docs | Placeholder in `docs/screenshots/` |

## Known bugs
See §11 for full list with status.

---

# 2. Folder Structure

```
alligator-apply/                    # Project root (this handoff applies here)
├── .env                            # Local secrets & config (gitignored)
├── .env.example                    # Template for env vars
├── .gitignore
├── README.md                       # User-facing setup & demo guide
├── PROJECT_HANDOFF.md              # This document
│
├── backend/
│   ├── package.json
│   ├── data/
│   │   ├── alligator.db            # SQLite DB (gitignored)
│   │   ├── mock_jobs.json          # Mock scan data
│   │   ├── source_targets.json     # Legacy per-source company slugs
│   │   └── registry/               # Seed JSON per ATS (greenhouse, lever, etc.)
│   ├── scripts/                    # Tests, debug, registry seed/import
│   ├── uploads/resumes/            # Uploaded resumes (gitignored)
│   ├── outputs/application_packets/ # Generated packets (gitignored)
│   └── src/
│       ├── server.js               # Express entry point
│       ├── db/                     # SQLite schema + migrations
│       ├── routes/                 # REST route handlers
│       ├── services/               # Business logic
│       ├── sources/                # ATS adapters + scan pipeline
│       ├── agents/                 # Career / Copilot agents (template + watsonx stubs)
│       ├── config/                 # Product capabilities manifest
│       └── workers/                # Future queue worker stub
│
├── frontend/
│   ├── package.json
│   ├── vite.config.js              # Port 5173 + API proxy
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── scripts/                    # Frontend unit tests
│   └── src/
│       ├── main.jsx                # React entry
│       ├── App.jsx                 # Router
│       ├── pages/                  # Route pages
│       ├── components/             # UI components
│       ├── hooks/                  # React hooks
│       └── lib/                    # API client, constants, scope helpers
│
└── docs/
    └── screenshots/                # Screenshot placeholders for README
```

**Parent repo note:** `../alligator_apply/` (outside this folder) contains a **legacy Python/Streamlit** app. It is reference-only and **not** wired to this React stack.

---

# 3. Backend

## Path
`backend/`

## Entry point
`backend/src/server.js`

## Server startup
- **Dev:** `cd backend && npm run dev` → `node --watch src/server.js`
- **Prod:** `npm start` → `node src/server.js`
- On boot: loads `.env` from project root (`../../.env` relative to `server.js`), opens SQLite, runs `recoverInterruptedScans()`, backfills `normalized_location`.

## Middleware
| Concern | File |
|---------|------|
| CORS | `server.js` — `cors({ origin: FRONTEND_URL })` |
| JSON body | `server.js` — `express.json()` |
| File upload (resume) | `routes/resume.routes.js` — `multer` |

No global auth middleware (single-user local app).

## API routes
| Mount | File | Purpose |
|-------|------|---------|
| `/api/health` | `server.js` | Health + mockMode flag |
| `/api/settings` | `server.js` | User settings GET/PUT |
| `/api/capabilities` | `server.js` | Feature manifest |
| `/api/sources` | `routes/sources.routes.js` | Enable/disable sources, legacy targets |
| `/api/resume` | `routes/resume.routes.js` | Resume upload/status/delete |
| `/api/jobs` | `routes/jobs.routes.js` | Jobs list, scan, KPI, funnel, export |
| `/api/applications` | `routes/applications.routes.js` | CRM CRUD, pipeline, import/export |
| `/api/auto-apply` | `routes/autoApply.routes.js` | Batch/single auto-apply (mock guard) |
| `/api/copilot` | `routes/copilot.routes.js` | Career Copilot chat |
| `/api/registry` | `routes/registry.routes.js` | Company registry CRUD |

## Services (key files)
| Service | File |
|---------|------|
| Job scan orchestration | `services/jobScanService.js` |
| Job listing / funnel / KPI | `services/jobScanService.js` |
| SQL filter builder | `services/jobQuery.js` |
| Search-intent ranking | `services/searchIntentScore.js` |
| Rejection reasons | `services/jobRejection.js` |
| Scan metrics / run resolution | `services/scanMetrics.js` |
| Scan diagnostics | `services/scanDiagnostics.js` |
| Resume upload/parse | `services/resumeService.js`, `services/resumeParser.js` |
| Resume scoring context | `services/resumeScoringContext.js` |
| Location normalization | `services/locationService.js`, `services/locationQuery.js` |
| Application packets | `services/packetService.js` |
| Copilot | `services/copilotService.js`, `services/copilotContext.js` |
| Applications CRM | `services/applicationCrmService.js` |
| Auto-apply | `services/autoApplyService.js`, `services/playwrightService.js` |
| Settings | `services/settingsService.js` |
| Source store (legacy targets) | `services/sourceStore.js` |
| Sources API logic | `services/sourcesService.js` |
| Registry API | `services/registryService.js` |
| Company registry store | `services/companyRegistry/registryStore.js` |
| Registry import | `services/companyRegistry/registryImport.js` |
| Registry scan planning | `services/companyRegistry/registryScanPlanner.js` |
| Registry seed loader | `services/companyRegistry/registrySeedLoader.js` |

## Adapters (ATS providers)
Registered in `sources/providers/providerRegistry.js`. Each adapter extends `sources/base.adapter.js`.

| Provider | Adapter file |
|----------|--------------|
| Greenhouse | `sources/greenhouse.adapter.js` |
| Lever | `sources/lever.adapter.js` |
| Ashby | `sources/ashby.adapter.js` |
| SmartRecruiters | `sources/smartrecruiters.adapter.js` |
| Workday | `sources/workday.adapter.js` (+ `sources/workdayCxs.js`) |
| BambooHR (stub) | `sources/bamboohr.adapter.js` |
| iCIMS (stub) | `sources/icims.adapter.js` |
| Jobvite (stub) | `sources/jobvite.adapter.js` |
| JazzHR (stub) | `sources/jazzhr.adapter.js` |
| Teamtailor (stub) | `sources/teamtailor.adapter.js` |

Shared provider runner: `sources/providers/providerRunner.js`  
HTTP client: `sources/httpClient.js`

## Database layer
| File | Role |
|------|------|
| `db/database.js` | SQLite connection (`better-sqlite3`), schema apply, migrations |
| `db/schema.sql` | Base tables |
| `db/migrations.sql` | Phase 3+ tables (registry, source_targets, job_sources) |

## Registry
| File | Role |
|------|------|
| `services/companyRegistry/registryStore.js` | CRUD for companies + registry entries |
| `services/companyRegistry/registryScanPlanner.js` | Registry-first target planning |
| `services/companyRegistry/registryImport.js` | Import seed JSON into DB |
| `services/registryService.js` | API-facing registry operations |
| `data/registry/*.json` | Per-ATS seed company lists |
| `routes/registry.routes.js` | REST endpoints |

## Scoring
| Layer | File |
|-------|------|
| Resume match score | `sources/matchScore.js` |
| Quality / metadata score | `sources/qualityScore.js` |
| Combined enrich + persist score | `sources/qualityScore.js` → `enrichJobQuality`, `lightEnrichJob` |
| Visa signals | `sources/visaSignals.js` |
| Scoring context (resume skills) | `services/resumeScoringContext.js` |

## Scan pipeline
| Stage | File |
|-------|------|
| Scan start / state | `services/jobScanService.js` → `startScanJob`, `runAdapterPipeline` |
| Orchestration | `sources/scanOrchestrator.js` → `runSourceScan` |
| Provider fetch loop | `sources/providers/providerRunner.js` |
| Early filter (fetch stage) | `sources/earlyFilter.js`, `sources/jobFetchFilter.js` |
| Dedupe | `sources/dedupe.js` |
| Enrichment + scoring | `sources/qualityScore.js` |
| Persistence | `services/jobScanService.js` → `persistJobs`, `persistJobsQueued` |
| Diagnostics | `services/scanDiagnostics.js` |
| Config / limits | `sources/scanConfig.js`, `sources/sourceConfig.js` |
| Source cache | `sources/sourceCache.js` |
| Mock vs live | `sources/liveSearch.js` |

## Filtering (list-time vs fetch-time)
| Layer | File | Behavior |
|-------|------|----------|
| Fetch-time early filter | `sources/earlyFilter.js` | Permissive pass-through for broad role queries |
| Fetch filter stats | `sources/jobFetchFilter.js` | Keyword/location filter during adapter fetch |
| SQL list filters | `services/jobQuery.js` → `buildJobWhereClause` | Tab filters, scan scope; **bypassed for intent ranking** |
| Filter recovery (legacy path) | `services/jobScanService.js` → `applyAllTabFilterRecovery` | Drops zero-result location/keyword SQL filters |
| Search-intent ranking | `services/searchIntentScore.js` | Ranks all scan jobs without hard keyword/location SQL filter |

## Ranking (list results)
| File | Role |
|------|------|
| `services/searchIntentScore.js` | `computeSearchIntentScore`, `scoreAndSortJobRows` |
| `services/jobScanService.js` → `listJobs` | Applies intent ranking when `scanRunId` present |
| `services/jobQuery.js` → `buildSortClause` | SQL sort for saved-only / non-intent paths |

## Persistence
| File | Role |
|------|------|
| `services/jobScanService.js` | `persistJobs`, `jobToDbRow` via `sources/types.js` |
| `services/scanMetrics.js` | `computePersistedMetrics`, `resolveActiveScanRunId` |
| `scan_runs` table | Scan metadata + `search_filters` signature |

---

# 4. Frontend

## Framework
- **React 18** + **Vite 6**
- **react-router-dom 7** for routing
- **Tailwind CSS 3** for styling
- **lucide-react** icons, **recharts** for charts
- **No TypeScript** (plain JSX)
- **No Redux** — local React state + `localStorage` for saved search

## Entry point
`frontend/src/main.jsx` → renders `App`

## Router
`frontend/src/App.jsx`

| Route | Page component |
|-------|----------------|
| `/` | Redirect → `/dashboard` |
| `/dashboard` | `pages/Dashboard.jsx` |
| `/job-hunt` | `pages/JobHunt.jsx` |
| `/applications` | `pages/Applications.jsx` |
| `/analytics` | `pages/JobStatistics.jsx` |
| `/copilot` | `pages/CareerCopilot.jsx` |
| `/settings` | `pages/Settings.jsx` |
| `/statistics` | Redirect → `/analytics` |

Layout wrapper: `components/AppLayout.jsx` (sidebar + outlet)

## Pages
| File | Purpose |
|------|---------|
| `pages/Dashboard.jsx` | KPI overview |
| `pages/JobHunt.jsx` | Resume, filters, scan, results table |
| `pages/Applications.jsx` | CRM Kanban + table |
| `pages/JobStatistics.jsx` | Pipeline analytics |
| `pages/CareerCopilot.jsx` | Copilot chat |
| `pages/Settings.jsx` | Profile, registry, sources, capabilities |

## Components (key)
| File | Purpose |
|------|---------|
| `ScanControlCard.jsx` | Scan UI + resume upload |
| `JobFilters.jsx` | Keyword, location, advanced filters |
| `JobsTable.jsx` | Paginated job results |
| `JobResultsTabs.jsx` | All / Recommended / Auto-apply tabs |
| `HuntKpiCards.jsx` | Jobs found, matched, saved KPIs |
| `LocationZeroResults.jsx` | Location fallback banner |
| `JobDetailDrawer.jsx` | Job detail + actions |
| `ApplicationPacketModal.jsx` | Packet preview |
| `CompanyRegistryManager.jsx` | Registry CRUD in Settings |
| `AdvancedSourcesPanel.jsx` | Per-source enable toggles |
| `DataModeBanner.jsx` | Mock vs live indicator |
| `ManualReviewPanel.jsx` | Manual review queue |
| `ui/*` | Button, Card, Dialog, Input, Badge, Dropdown |

## Hooks
| File | Purpose |
|------|---------|
| `hooks/useJobResults.js` | Fetches jobs + funnel; passes `scanRunId`; pagination |

## API layer
`frontend/src/lib/api.js` — all `fetch` calls to `/api/*` (proxied to backend in dev)

## State management
- **React `useState` / `useEffect` / `useCallback` / `useRef`** in pages
- **`resultsScanRunId`** in `JobHunt.jsx` — scopes hunt results to active scan
- **`frontend/src/lib/scanResultsScope.js`** — when to clear `resultsScanRunId` (keywords, location, remoteType only)
- **`api.loadSavedSearch()` / `api.saveSearch()`** — `localStorage` for filter persistence
- **`useSidebar()`** in `AppLayout.jsx` — sidebar refresh context

---

# 5. Ports

| Service | Port | Configured in |
|---------|------|---------------|
| **Frontend (Vite dev)** | `5173` | `frontend/vite.config.js` → `server.port` |
| **Backend API** | `4000` | `.env` → `PORT=4000`; fallback in `backend/src/server.js` |
| **API proxy** | Vite proxies `/api` → `http://localhost:4000` | `frontend/vite.config.js` → `server.proxy` |
| **CORS origin** | `http://localhost:5173` | `.env` → `FRONTEND_URL` |

**Database:** SQLite file — no TCP port. Path: `.env` → `DATABASE_PATH=./backend/data/alligator.db`

**Note:** Port 5173 conflicts if another Vite app (e.g. Cyber Shark) is running on the same machine. Kill the conflicting process before starting Alligator Apply frontend.

---

# 6. Environment

All variables live in project root `.env` (copy from `.env.example`). Loaded by `backend/src/server.js` via `dotenv`.

## Required for basic local dev
| Variable | Purpose |
|----------|---------|
| `PORT` | Backend listen port (default 4000) |
| `FRONTEND_URL` | CORS origin for frontend |
| `DATABASE_PATH` | SQLite file path |
| `RESUMES_DIR` | Directory for uploaded resume files |

## Required for live scans
| Variable | Purpose |
|----------|---------|
| `MOCK_MODE` | `false` for live ATS APIs; `true` for offline demo |
| `JOB_SOURCES` | Comma-separated enabled sources |

## Optional — scan tuning
| Variable | Default | Purpose |
|----------|---------|---------|
| `MAX_COMPANIES_PER_SOURCE` | 10 (`.env` has 20) | Max registry/env targets per source per scan |
| `SOURCE_TIMEOUT_MS` | 12000 (`.env` has 60000) | Per-request HTTP timeout |
| `SCAN_TIMEOUT_MS` | 60000 | Global scan pipeline timeout |
| `MAX_RESULTS_PER_SOURCE` | 50 (`.env` has 25) | Max jobs fetched per source |
| `MAX_TOTAL_RESULTS` | 200 (`.env` has 500) | Cap total jobs per scan |
| `COMPANY_CONCURRENCY` | 3 (`.env` has 5) | Parallel company fetches per source |
| `FAST_SCAN` | false | Skip expensive Greenhouse content fetch |
| `GREENHOUSE_FETCH_CONTENT` | false | Fetch full Greenhouse job descriptions |
| `SOURCE_CACHE_TTL_MINUTES` | 30 | Source response cache TTL |

## Optional — company targets (override registry)
| Variable | Purpose |
|----------|---------|
| `GREENHOUSE_BOARDS` | Comma-separated board tokens |
| `LEVER_COMPANIES` | Comma-separated Lever company slugs |
| `ASHBY_BOARDS` | Comma-separated Ashby board names |
| `SMARTRECRUITERS_COMPANIES` | Comma-separated SmartRecruiters company IDs |

Leave undefined to use Company Registry DB + `backend/data/source_targets.json` fallback.

## Optional — safety / AI
| Variable | Purpose |
|----------|---------|
| `AUTO_SUBMIT` | `false` by default; never auto-submit applications |
| `OPENAI_API_KEY` | Legacy/unused by this stack |
| `WATSONX_API_KEY` | IBM watsonx (planned LLM agent) |
| `WATSONX_PROJECT_ID` | watsonx project |
| `WATSONX_MODEL_ID` | Model ID (default `ibm/granite-13b-chat-v2`) |
| `APIFY_TOKEN_1` | Optional integration (unused in core flow) |
| `TAVILY_API_KEY` | Optional integration (unused in core flow) |
| `PACKET_OUTPUT_DIR` | Override packet output path (default `backend/outputs/application_packets`) |
| `TEST_KEYWORDS` | Used only by `scripts/testSources.js` |

---

# 7. Database

## Type
**SQLite** via `better-sqlite3`

## File location
`backend/data/alligator.db` (path from `DATABASE_PATH` in `.env`)

## Schema files
- `backend/src/db/schema.sql` — base tables
- `backend/src/db/migrations.sql` — registry, source_targets, job_sources
- `backend/src/db/database.js` — applies schema + incremental `ALTER TABLE` guards

## Important tables

### `resume_profiles`
Uploaded resumes, extracted text, parsed JSON profile, parse status.

### `jobs`
Core job listings. Key columns:
- `id`, `company`, `title`, `url`, `source`, `score`
- `location`, `normalized_location`, `remote_type`
- `visa_fit`, `auto_apply_eligible`, `pipeline_status`
- `data_source` (`live` | `mock`)
- `scan_run_id` — ties job to a scan session
- `quality_checks` — JSON with match breakdown, skills
- `is_saved`, `is_hidden`

### `scan_runs`
Scan session metadata:
- `id`, `status`, `progress`, `message`, `jobs_found`
- `jobs_matched`, `eligible_count`, `search_filters` (JSON signature)
- `source_summary`, `scan_report`, `failed_sources`
- `started_at`, `finished_at`

### `applications`
CRM application records linked to `jobs.id`.

### `application_status_history`
Status change audit trail.

### `auto_apply_attempts`
Auto-apply run log per job.

### `manual_review_items`
Jobs flagged for manual review (visa, unknown fields, etc.).

### `user_settings`
Key-value user preferences.

### Registry tables (`migrations.sql`)
- `companies` — company master
- `company_tags`, `company_tag_links`
- `company_registry_entries` — per-source board tokens + Workday `connection_payload`

### Legacy source tables
- `job_sources` — enable/disable sources
- `source_targets` — legacy slug list per source

**No `users` table** — single-user local app, no authentication.

---

# 8. Scan Pipeline

Complete execution flow with files:

```
Resume Upload
  frontend: components/ResumeUpload.jsx
  frontend: lib/api.js → POST /api/resume/upload
  backend:  routes/resume.routes.js
  backend:  services/resumeService.js
  backend:  services/resumeParser.js
  DB:       resume_profiles
        ↓
Scan Start
  frontend: pages/JobHunt.jsx → handleStartHunt
  frontend: lib/api.js → POST /api/jobs/scan
  backend:  routes/jobs.routes.js
  backend:  services/jobScanService.js → startScanJob
  DB:       INSERT scan_runs (status=running, search_filters)
        ↓
Registry Selection
  backend:  services/jobScanService.js → getTargetsForSource
  backend:  sources/sourceConfig.js
  backend:  services/companyRegistry/registryScanPlanner.js
  backend:  services/companyRegistry/registryStore.js
  fallback: services/sourceStore.js + data/source_targets.json
  env override: GREENHOUSE_BOARDS, LEVER_COMPANIES, etc.
        ↓
Provider Fetch (parallel per source)
  backend:  services/jobScanService.js → runAdapterPipeline
  backend:  sources/scanOrchestrator.js → runSourceScan
  backend:  sources/providers/providerRegistry.js → createActiveProviders
  backend:  sources/providers/providerRunner.js → runProviderSearch
  adapters: greenhouse.adapter.js | lever.adapter.js | ashby.adapter.js |
            smartrecruiters.adapter.js | workday.adapter.js
  backend:  sources/httpClient.js
  backend:  sources/liveSearch.js (mock delay / finalize)
  backend:  sources/sourceCache.js
        ↓
Normalization
  adapters: *.adapter.js → normalize() / buildNormalizedJob
  backend:  sources/base.adapter.js
  backend:  sources/types.js → jobToDbRow
  backend:  services/locationService.js → normalizeLocation
        ↓
Early Filter (fetch stage — permissive)
  backend:  sources/earlyFilter.js → passesEarlyFilter
  backend:  sources/jobFetchFilter.js → filterJobsWithStats
        ↓
Scoring
  backend:  services/resumeScoringContext.js
  backend:  sources/matchScore.js → calculateResumeMatchScore
  backend:  sources/qualityScore.js → enrichJobQuality, lightEnrichJob
  backend:  sources/visaSignals.js
        ↓
Deduplication
  backend:  sources/dedupe.js
        ↓
Persistence (incremental during scan)
  backend:  services/jobScanService.js → persistJobs / persistJobsQueued
  backend:  services/scanMetrics.js → computePersistedMetrics
  backend:  services/scanDiagnostics.js
  DB:       jobs (+ applications rows), UPDATE scan_runs
        ↓
Ranking (at list time, not during scan)
  backend:  services/searchIntentScore.js
  backend:  services/jobScanService.js → listJobs (rankByIntent path)
        ↓
Frontend Display
  frontend: pages/JobHunt.jsx (resultsScanRunId scope)
  frontend: hooks/useJobResults.js
  frontend: lib/api.js → GET /api/jobs, /api/jobs/kpi, /api/jobs/funnel
  frontend: components/JobsTable.jsx, HuntKpiCards.jsx, JobResultsTabs.jsx
```

**Scan completion:** `scanOrchestrator.js` → `jobScanService.js` → `markScanComplete` updates `scan_runs` + in-memory `scanState`. Frontend polls `GET /api/jobs/scan/status` and keeps `resultsScanRunId` for result fetches.

---

# 9. ATS Providers

## Greenhouse
| Item | Detail |
|------|--------|
| Adapter | `backend/src/sources/greenhouse.adapter.js` |
| Registry seed | `backend/data/registry/greenhouse.json` |
| Fetch | `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs` |
| Normalization | `GreenhouseAdapter.normalize()` → `buildNormalizedJob` |
| Limitations | Public boards only; known board tokens required; no global search; optional full content fetch (`GREENHOUSE_FETCH_CONTENT`) |

## Lever
| Item | Detail |
|------|--------|
| Adapter | `backend/src/sources/lever.adapter.js` |
| Registry seed | `backend/data/registry/lever.json` |
| Fetch | `GET https://api.lever.co/v0/postings/{company}?mode=json` |
| Normalization | `LeverAdapter.normalize()` |
| Limitations | Per-company JSON feed; keyword filtering client-side |

## Ashby
| Item | Detail |
|------|--------|
| Adapter | `backend/src/sources/ashby.adapter.js` |
| Registry seed | `backend/data/registry/ashby.json` |
| Fetch | `GET https://api.ashbyhq.com/posting-api/job-board/{board}` |
| Normalization | `AshbyAdapter.normalize()` |
| Limitations | Per-organization board; case-sensitive board name; many listings are remote/global |

## SmartRecruiters
| Item | Detail |
|------|--------|
| Adapter | `backend/src/sources/smartrecruiters.adapter.js` |
| Registry seed | `backend/data/registry/smartrecruiters.json` |
| Fetch | `GET https://api.smartrecruiters.com/v1/companies/{id}/postings` |
| Normalization | `SmartRecruitersAdapter.normalize()` |
| Limitations | Paginated postings; minimal description fetch to limit API load |

## Workday
| Item | Detail |
|------|--------|
| Adapter | `backend/src/sources/workday.adapter.js` |
| CXS helpers | `backend/src/sources/workdayCxs.js` |
| Registry seed | `backend/data/registry/workday.json` |
| Fetch | Workday CXS API (tenant/wdInstance/hostSlug/site in `connection_payload`) |
| Normalization | `WorkdayAdapter.normalize()` |
| Limitations | Opt-in (`JOB_SOURCES` must include `workday`); registry entries need CXS config; jobs never auto-apply eligible; more complex setup |

**Registry import:** `npm run registry:import` (script: `backend/scripts/registryImport.js`)

---

# 10. Current Ranking Logic

## searchIntentScore
- **File:** `backend/src/services/searchIntentScore.js`
- **When applied:** At **list time** in `listJobs()` when a `scanRunId` is resolved (hunt results). Does **not** hard-filter jobs out.
- **Signals:**
  - Title keyword match (full phrase, all terms, individual terms)
  - Role boosts: Java, Full Stack, Backend, Software Engineer, Spring, React, etc.
  - Role penalties: Product Engineer, Account Executive, Customer Engineer, Solutions Architect, Designer
  - Location intent tiers: city exact → state → Remote US → US → North America → SF/Europe (lower)
  - Remote preference bonus when `remoteType=remote`
- **Output fields on each job:** `searchIntentScore`, `searchIntentReasons[]`
- **Sort:** `searchIntentScore DESC`, then `matchScore DESC` (then user `sortBy` tiebreaker)

## Resume match score (matchScore)
- **File:** `backend/src/sources/matchScore.js` → `calculateResumeMatchScore`
- **When applied:** During scan enrichment (`qualityScore.js`)
- **Inputs:** Resume skills from `resumeScoringContext.js` + filter keywords; preferred location
- **Logic:** Skill overlap in title/description, location bonus, sales-vs-engineering title penalty
- **Stored as:** `jobs.score` and breakdown in `quality_checks` JSON

## Quality score
- **File:** `backend/src/sources/qualityScore.js` → `calculateQualityScore`
- **Purpose:** Metadata completeness (apply URL, description, location, company, title, recency)
- **Combined:** `resolveScore()` blends match (75%) + quality (25%) when skills match

## Location score (within search intent)
- **File:** `backend/src/services/searchIntentScore.js` → `scoreLocationIntent`
- **Uses:** `services/locationService.js` → `expandLocationTerms`, `locationMatches`
- **Not a separate DB column** — computed at list time

## SQL sorting (legacy / saved jobs)
- **File:** `backend/src/services/jobQuery.js` → `buildSortClause`
- Used when `rankByIntent` is false (e.g. `savedOnly=true`)

## Frontend sort
- **File:** `frontend/src/pages/JobHunt.jsx` — `sortBy` state passed to `useJobResults`
- Default: `score` (backend applies intent ranking first when scan-scoped)

---

# 11. Current Known Bugs

| Issue | Status | Notes |
|-------|--------|-------|
| Hunt results drop to 0 after scan completes | **Resolved** | Frontend keeps `resultsScanRunId`; `frontend/src/lib/scanResultsScope.js` |
| Early filter dropped all jobs for broad role queries (e.g. Full Stack Java + US) | **Resolved** | Permissive `earlyFilter.js`; test: `npm run test:early-filter` |
| Irrelevant titles ranked at top (Product Engineer, Customer Engineer) for Java searches | **Resolved** (needs live validation) | `searchIntentScore.js`; test: `npm run test:search-intent` |
| Different keywords/locations showing identical top results | **In Progress** | Intent ranking added; verify after backend restart + fresh scan |
| Port 5173 serving wrong app (Cyber Shark conflict) | **Resolved** | Environmental — kill conflicting Vite process |
| Large uncommitted changes not on `origin/main` | **Open** | Risk of lost work; commit when ready |
| watsonx / OpenAI agents not wired | **Open** | Template fallback only |
| Playwright auto-apply not production-ready | **Open** | Mock guard in `autoApply.routes.js` |
| Workday jobs never auto-apply eligible | **Open** | By design until manual review flow matures |
| No authentication / multi-user | **Open** | Out of MVP scope |
| `npm run test:all` does not include `test:search-intent`, `test:scan-results-scope`, `test:early-filter` | **Open** | Add to `test:all` when stabilizing |

---

# 12. NPM Commands

## Root
No root `package.json`. Run commands from `backend/` or `frontend/`.

## Backend (`cd backend`)

### Dev / run
| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Start API with file watch |
| `npm start` | Start API (no watch) |
| `npm run worker:scan` | Standalone scan worker stub |

### Registry
| Command | Purpose |
|---------|---------|
| `npm run registry:import` | Import seed JSON into registry DB |
| `npm run registry:seed:workday` | Seed Workday registry entries |
| `npm run registry:seed:expansion` | Seed expansion dataset |
| `npm run registry:seed:validate` | Validate expansion seed |
| `npm run registry:build-seed` | Build seed datasets from manifest |

### Debug
| Command | Purpose |
|---------|---------|
| `npm run debug:greenhouse` | Live Greenhouse adapter verify |
| `npm run debug:ashby` | Live Ashby adapter verify |
| `npm run debug:workday` | Live Workday adapter verify |
| `npm run debug:scan-pipeline` | End-to-end scan pipeline debug |

### Tests
| Command | Purpose |
|---------|---------|
| `npm run test:all` | Run main test suite |
| `npm run test:resume` | Resume parser |
| `npm run test:scoring` | Match scoring |
| `npm run test:packet` | Packet generation |
| `npm run test:copilot` | Copilot service |
| `npm run test:quality` | Quality + filters |
| `npm run test:providers` | Provider smoke tests |
| `npm run test:workday` | Workday CXS + adapter |
| `npm run test:list-jobs` | Job listing + scan scope |
| `npm run test:scan-switch` | Scan filter switching |
| `npm run test:scan-results-scope` | Backend scanRunId scope API test |
| `npm run test:early-filter` | Early filter permissiveness |
| `npm run test:search-intent` | Search-intent ranking |
| `npm run test:sources` | Source adapter integration |
| `npm run test:registry` | Full registry test suite |
| `npm run test:registry-planner` | Registry scan planner |
| `npm run test:registry-api` | Registry REST API |
| `npm run test:registry-expansion` | Registry expansion seeds |

## Frontend (`cd frontend`)
| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `npm run dev` | Vite dev server (port 5173) |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run test:scan-scope` | Frontend scanResultsScope unit test |

---

# 13. Current Tests

| Test script | Validates |
|-------------|-----------|
| `testResumeParser.js` | PDF/DOCX text extraction and profile fields |
| `testResumeScoring.js` | `matchScore.js` skill matching |
| `testPacketGeneration.js` | Application packet output |
| `testCopilot.js` | Copilot chat actions |
| `testQuality.js` | Quality score, visa signals, SQL location filters |
| `testProviders.js` | Adapter fetch smoke (mock or live) |
| `testWorkdayCxs.js` | Workday CXS request builder |
| `testWorkdayAdapter.js` | Workday adapter normalize/fetch |
| `testListJobs.js` | `listJobs` pagination, scan scope, location recovery |
| `testScanSwitch.js` | Switching scans does not leak old jobs |
| `testScanResultsScope.js` | API returns same count with `scanRunId` during/after scan |
| `testEarlyFilter.js` | Broad role queries pass early filter |
| `testSearchIntentScore.js` | Java roles rank above Product/Customer; Tampa above SF/Europe |
| `testSources.js` | Multi-source integration |
| `testCompanyRegistry.js` | Registry store CRUD |
| `testRegistryScanPlanner.js` | Registry-first target planning |
| `testRegistryApi.js` | Registry REST endpoints |
| `testRegistryExpansion.js` | Expansion seed data integrity |
| `frontend/scripts/testScanResultsScope.js` | Frontend scope key logic (minScore does not clear scope) |

---

# 14. Development Workflow

## Start frontend
```bash
cd frontend
npm install   # first time
npm run dev
# → http://localhost:5173
```

## Start backend
```bash
cd backend
npm install   # first time
cp ../.env.example ../.env   # first time
npm run dev
# → http://localhost:4000/api/health
```

## Run scans
1. Upload resume on **Job Hunt** page
2. Set keywords + location + filters
3. Click **Run scan** (requires `MOCK_MODE=false` for live)
4. Watch console: `[JobHunt] scan started id=`, `[JobHunt] scan completed id=`
5. Verify `getJobs` / `getKpi` / `getFunnel` log same `scanRunId`

## Seed registry
```bash
cd backend
npm run registry:import
npm run registry:seed:workday    # optional Workday targets
```

## Run tests
```bash
cd backend
npm run test:search-intent
npm run test:scan-results-scope
npm run test:list-jobs
npm run test:all

cd ../frontend
npm run test:scan-scope
```

## Debug providers
```bash
cd backend
npm run debug:greenhouse
npm run debug:ashby
npm run debug:workday
npm run debug:scan-pipeline
```

## Restart backend
- `npm run dev` uses `--watch` — saves to `src/` auto-restart
- Manual: Ctrl+C, then `npm run dev`
- After `.env` changes: restart required
- Verify: `curl http://localhost:4000/api/health`

---

# 15. Git

## Current branch
`main` (up to date with `origin/main` at last fetch)

## Important branches
- `main` — only branch on remote (`origin/main`)

## Uncommitted changes (as of handoff generation)
**Modified (tracked):** `.env.example`, `.gitignore`, `README.md`, `backend/package.json`, `backend/src/db/*`, multiple `backend/src/routes/*`, `backend/src/services/jobScanService.js`, `backend/src/server.js`, most `frontend/src/*` pages and components.

**Untracked (major):** Entire `backend/scripts/`, `backend/src/sources/`, `backend/src/agents/`, `backend/src/config/`, `backend/data/registry/`, `docs/`, `frontend/src/hooks/`, `frontend/src/lib/scanResultsScope.js`, many new components.

**Recommendation:** Review `git status`, commit logical chunks, push to remote before switching tools.

## Ignored files (`.gitignore`)
- `.env`, `.env.local`
- `node_modules/`
- `backend/data/*.db`
- `backend/uploads/**`
- `backend/outputs/`
- `frontend/dist/`
- `*.log`, IDE folders

---

# 16. Important Config Files

| File | Purpose |
|------|---------|
| `backend/package.json` | Backend scripts and dependencies |
| `frontend/package.json` | Frontend scripts and dependencies |
| `frontend/vite.config.js` | Vite port 5173, `@` alias, `/api` proxy |
| `frontend/tailwind.config.js` | Tailwind theme |
| `frontend/postcss.config.js` | PostCSS + Tailwind |
| `.env` | Runtime secrets and tuning (gitignored) |
| `.env.example` | Documented env template |
| `.gitignore` | Git exclusions |
| `backend/src/db/schema.sql` | Base SQLite schema |
| `backend/src/db/migrations.sql` | Incremental schema |
| `backend/data/source_targets.json` | Legacy company slugs per source |
| `backend/data/registry/manifest.json` | Registry seed manifest |
| `backend/src/config/productCapabilities.js` | Feature capability manifest |
| `backend/src/sources/scanConfig.js` | Scan timeout/limit env readers |
| `backend/src/sources/sourceConfig.js` | JOB_SOURCES + target resolution |

**No `tsconfig.json` or ESLint config** in this project.

---

# 17. Immediate Next Task

Based on current project state, prioritize in this order:

1. **Commit and push uncommitted work** — Large delta of registry, sources, ranking, and frontend scope fixes is only local. Create logical commits before continuing in Claude Code.

2. **Live validation of search-intent ranking** — Restart backend, run scan with `Full Stack Java Developer` + `Tampa, FL`, confirm top rows are Java/full-stack titles (not Product/Customer Engineer) and Tampa/Remote US locations rank above SF/Europe. Check `searchIntentReasons` in API response.

3. **Manual E2E: scan results persistence** — Run scan → 75 jobs during scan → still 75 after complete. Console must show same `scanRunId` on getJobs/getKpi/getFunnel. See `frontend/scripts/testScanResultsScope.js` header for checklist.

4. **Add missing tests to `test:all`** — Include `test:search-intent`, `test:early-filter`, `test:scan-results-scope`.

5. **Registry population for live demos** — If registry empty, `npm run registry:import` before live scans.

---

# 18. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React/Vite :5173)                          │
│  JobHunt.jsx ── useJobResults.js ── api.js ── /api proxy ──────────────┐   │
│  Settings.jsx (Registry)   Applications.jsx   CareerCopilot.jsx          │   │
└──────────────────────────────────────────────────────────────────────────│───┘
                                                                           │
                                    HTTP REST                              │
                                                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      BACKEND (Express :4000)  server.js                      │
│  routes/  resume | jobs | applications | auto-apply | copilot | registry    │
└───────┬─────────────────────────────────────────────────────────────────────┘
        │
        ├─► resumeService / resumeParser ──► resume_profiles (SQLite)
        │
        ├─► jobScanService.startScanJob
        │         │
        │         ├─► registryScanPlanner ──► company_registry_entries
        │         │         (fallback: source_targets.json)
        │         │
        │         └─► scanOrchestrator.runSourceScan
        │                   │
        │                   ├─► providerRunner ──► [Greenhouse|Lever|Ashby|SR|Workday]
        │                   │         │
        │                   │         ├─ earlyFilter / jobFetchFilter
        │                   │         ├─ normalize (adapters)
        │                   │         ├─ qualityScore + matchScore
        │                   │         └─ dedupe
        │                   │
        │                   └─► persistJobs ──► jobs (+ scan_run_id)
        │                                    ──► scan_runs (metadata)
        │
        ├─► listJobs ──► searchIntentScore (rank) ──► JSON + pagination
        │
        ├─► packetService ──► agents/templateCareerAgent ──► outputs/
        │
        └─► copilotService ──► agents/templateCopilotAgent

┌──────────────────┐     ┌──────────────────────────────────────────────┐
│  SQLite DB       │     │  External ATS APIs                              │
│  alligator.db    │     │  greenhouse.io | lever.co | ashbyhq.com |       │
│  jobs            │     │  smartrecruiters.com | workday CXS              │
│  scan_runs       │     └──────────────────────────────────────────────┘
│  applications    │
│  registry tables │
└──────────────────┘
```

---

# Quick Start

Get productive in under 10 minutes:

```bash
# 1. Clone / open project
cd alligator-apply

# 2. Configure
cp .env.example .env
# For offline demo: MOCK_MODE=true
# For live scans: MOCK_MODE=false, ensure registry imported

# 3. Backend
cd backend && npm install && npm run dev

# 4. Frontend (new terminal)
cd frontend && npm install && npm run dev

# 5. Verify
# Browser: http://localhost:5173
# API:     http://localhost:4000/api/health

# 6. Optional — seed registry for live mode
cd backend && npm run registry:import

# 7. Smoke tests
npm run test:search-intent && npm run test:list-jobs

# 8. Demo flow
# Job Hunt → Upload resume → Set keywords/location → Run scan → Review results
```

**Key files to read first:** `README.md`, `backend/src/server.js`, `backend/src/services/jobScanService.js`, `frontend/src/pages/JobHunt.jsx`, `backend/src/services/searchIntentScore.js`.

**Safety:** Keep `AUTO_SUBMIT=false`. Never commit `.env` or `*.db` files.
