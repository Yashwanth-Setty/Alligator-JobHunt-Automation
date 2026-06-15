import time, json, logging, os, sys, sqlite3, hashlib, re, signal, threading
try:
    from fcntl import flock, LOCK_EX, LOCK_NB, LOCK_UN  # type: ignore[import]
    _HAS_FCNTL = True
except ImportError:
    flock = lambda *_a, **_k: None  # type: ignore[assignment]
    LOCK_EX = LOCK_NB = LOCK_UN = 0
    _HAS_FCNTL = False
from datetime import datetime, timedelta
from logging.handlers import RotatingFileHandler
from urllib.parse import urlparse
from collections import deque
from contextlib import contextmanager
import utils.env_loader  # noqa: F401 — loads .env from project root

from utils.liveness import check_liveness
from utils.archetype import detect_archetype
from utils.legitimacy import score_legitimacy
from utils.notifications import notify_match, notify_system
from utils.us_filter import partition_us_jobs, us_work_mode_priority, usa_only_enabled
from utils.apply_db import migrate_apply_columns, migrate_jobs_schema, migrate_pipeline_columns, run_migrations
from utils.query_rotation import detect_role_category
from filters import ALL_ROLE_KEYWORDS, TITLE_BLOCK, TITLE_REQUIRE_ONE

# ── secrets ───────────────────────────────────────────
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

def _valid_openai_key(k):
    return bool(k and k.startswith("sk-") and len(k) > 20)

def validate_env():
    global OPENAI_API_KEY
    OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
    if not _valid_openai_key(OPENAI_API_KEY):
        print("CRITICAL: OPENAI_API_KEY missing or invalid")
        sys.exit(1)

# ── paths (relative to this file, works on any machine) ─
BASE    = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE, "jobs.db")
LOG_DIR = os.path.join(BASE, "logs")
LOCK    = os.path.join(BASE, "alligator_apply.lock")

os.makedirs(LOG_DIR, exist_ok=True)

# ── .env permission warning ───────────────────────────
_env = os.path.join(BASE, ".env")
if os.path.exists(_env):
    mode = os.stat(_env).st_mode & 0o777
    if mode & 0o077:
        print(f"WARNING: .env permissions are {oct(mode)} — run: chmod 600 .env")

# ── logging ───────────────────────────────────────────
log = logging.getLogger("alligator_apply")
log.setLevel(logging.INFO)
log.addHandler(RotatingFileHandler(
    os.path.join(LOG_DIR, "run.log"),
    maxBytes=5_000_000,
    backupCount=3
))
log.addHandler(logging.StreamHandler(sys.stdout))

# ── rate limiter ──────────────────────────────────────
class RateLimiter:
    def __init__(self, calls_per_minute=15):
        self.calls_per_minute = calls_per_minute
        self.calls = deque()
        self.lock  = threading.Lock()

    def wait_if_needed(self):
        with self.lock:
            now = time.time()
            while self.calls and self.calls[0] < now - 60:
                self.calls.popleft()
            if len(self.calls) >= self.calls_per_minute:
                sleep_time = 60 - (now - self.calls[0])
                if sleep_time > 0:
                    log.info(f"Rate limit — waiting {sleep_time:.1f}s")
                    time.sleep(sleep_time)
            self.calls.append(time.time())

rate_limiter = RateLimiter(calls_per_minute=15)

# ── circuit breaker ───────────────────────────────────
class CircuitBreaker:
    def __init__(self, threshold=5, timeout=60):
        self.failures    = 0
        self.threshold   = threshold
        self.timeout     = timeout
        self.last_fail   = 0
        self.open        = False

    def call(self, fn, *args, **kwargs):
        if self.open:
            if time.time() - self.last_fail > self.timeout:
                self.open = False
                log.info("Circuit breaker: half-open, retrying")
            else:
                raise Exception("Circuit breaker OPEN — OpenAI API failing repeatedly")
        try:
            result       = fn(*args, **kwargs)
            self.failures = 0
            return result
        except Exception as e:
            self.failures  += 1
            self.last_fail  = time.time()
            if self.failures >= self.threshold:
                self.open = True
                log.error(f"Circuit breaker OPENED after {self.failures} failures")
            raise e

openai_cb = CircuitBreaker()

# ── run stats ─────────────────────────────────────────
class RunStats:
    def __init__(self):
        self.fetched         = 0
        self.us_jobs         = 0
        self.non_us_rejected = 0
        self.duplicates_skipped = 0
        self.skipped         = 0
        self.visa_block      = 0
        self.expired         = 0
        self.scored          = 0
        self.score_fail      = 0
        self.green           = 0
        self.amber           = 0
        self.red             = 0
        self.excel_rows      = 0

    def summary(self):
        base = (
            f"Fetched: {self.fetched} | "
            f"US Jobs: {self.us_jobs} | "
            f"Non-US Rejected: {self.non_us_rejected} | "
            f"Duplicates skipped: {self.duplicates_skipped} | "
            f"New: {self.us_jobs - self.skipped} | "
            f"Visa blocked: {self.visa_block} | "
            f"Expired: {self.expired} | "
            f"Scored: {self.scored} | "
            f"Score failed: {self.score_fail} | "
            f"GREEN: {self.green} | "
            f"AMBER: {self.amber} | "
            f"RED: {self.red} | "
            f"Excel rows: {self.excel_rows}"
        )
        return base

    def is_degraded(self):
        if self.fetched == 0:
            return "All scrapers returned zero jobs — check site structure"
        if usa_only_enabled() and self.us_jobs == 0 and self.fetched > 0:
            return "US filter rejected all jobs — check location metadata"
        if self.scored > 0 and (self.score_fail / self.scored) > 0.5:
            return f"Over 50% scoring failed ({self.score_fail}/{self.scored})"
        if self.fetched > 10 and (self.visa_block / max(self.us_jobs, 1)) > 0.9:
            return f"Visa filter blocking 90%+ ({self.visa_block}/{self.fetched})"
        if self.green > 20:
            return f"Suspiciously high GREEN count ({self.green}) — model may be drifting"
        if self.excel_rows == 0 and self.scored > 10:
            return "Zero jobs scored 70+ — check if scoring is too strict"
        return None

# ── lock (fcntl on Linux, PID-file on Windows) ────────
def acquire_lock():
    if _HAS_FCNTL:
        try:
            lf = open(LOCK, "w")
            flock(lf, LOCK_EX | LOCK_NB)
            lf.write(str(os.getpid()))
            lf.flush()
            return lf
        except BlockingIOError:
            log.warning("Another instance already running — exiting")
            sys.exit(0)
        except Exception as e:
            log.error(f"Lock failed: {e}", exc_info=True)
            sys.exit(1)
    else:
        # Windows: PID-file lock
        if os.path.exists(LOCK):
            try:
                pid = int(open(LOCK).read().strip())
                import psutil
                if psutil.pid_exists(pid):
                    log.warning("Another instance already running — exiting")
                    sys.exit(0)
            except Exception:
                pass
        try:
            open(LOCK, "w").write(str(os.getpid()))
        except Exception as e:
            log.error(f"Lock failed: {e}", exc_info=True)
        return None

def release_lock(lf):
    if _HAS_FCNTL and lf:
        try:
            flock(lf, LOCK_UN)
            lf.close()
        except Exception:
            pass
    try:
        os.remove(LOCK)
    except Exception:
        pass

# ── database ──────────────────────────────────────────
def get_db():
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id          TEXT PRIMARY KEY,
            title       TEXT,
            company     TEXT,
            url         TEXT,
            source      TEXT,
            score       INTEGER,
            seen_at     TEXT,
            date_posted TEXT
        )
    """)
    # Add date_posted column if upgrading from old schema
    try:
        db.execute("ALTER TABLE jobs ADD COLUMN date_posted TEXT")
        db.commit()
    except Exception:
        pass
    migrate_apply_columns(db)
    migrate_jobs_schema(db)
    migrate_pipeline_columns(db)
    db.commit()
    return db

def check_db_size(db, max_mb=100):
    if not os.path.exists(DB_PATH):
        return
    size_mb = os.path.getsize(DB_PATH) / (1024 * 1024)
    if size_mb > max_mb:
        log.critical(f"DB size {size_mb:.1f}MB — running cleanup")
        cleanup_old_jobs(db, days=30)

def cleanup_old_jobs(db, days=90):
    cutoff  = (datetime.now() - timedelta(days=days)).isoformat()
    deleted = db.execute("DELETE FROM jobs WHERE seen_at < ?", (cutoff,)).rowcount
    db.commit()
    # VACUUM must run outside any transaction
    il = db.isolation_level
    db.isolation_level = None
    db.execute("VACUUM")
    db.isolation_level = il
    log.info(f"Cleaned {deleted} jobs older than {days} days")

def normalize_url(url):
    if not url:
        return ""
    try:
        p      = urlparse(url)
        params = [x for x in p.query.split("&")
                  if not any(t in x for t in ["utm_", "ref=", "source=", "campaign="])]
        return p._replace(query="&".join(params)).geturl()[:500]
    except Exception:
        return url[:500]

def job_id(job):
    key = "|".join([
        normalize_url(job.get("url", "")),
        job.get("title",   "").lower().strip(),
        job.get("company", "").lower().strip(),
    ])
    return hashlib.sha256(key.encode()).hexdigest()[:32]

def _norm_text(text):
    return re.sub(r"\s+", " ", str(text or "").strip().lower())


def canonical_job_key(job):
    url = normalize_url(job.get("url", ""))
    p = urlparse(url) if url else None
    domain_path = f"{(p.netloc or '').lower()}{(p.path or '').rstrip('/')}" if p else ""
    base = "|".join([
        _norm_text(job.get("company", "")),
        _norm_text(job.get("title", "")),
        _norm_text(job.get("location", "")),
        domain_path[:500],
    ])
    return hashlib.sha256(base.encode()).hexdigest()[:40]


def touch_seen(existing_id, db):
    now = datetime.now().isoformat()
    db.execute(
        "UPDATE jobs SET last_seen_at=?, seen_count=COALESCE(seen_count,1)+1 WHERE id=?",
        (now, existing_id),
    )
    db.commit()


def mark_expired(job, db):
    ckey = canonical_job_key(job)
    db.execute(
        "UPDATE jobs SET expired=1, last_seen_at=? WHERE canonical_job_key=?",
        (datetime.now().isoformat(), ckey),
    )
    db.commit()


def is_new(job, db):
    jid = job_id(job)
    if not re.match(r'^[a-f0-9]{32}$', jid):
        log.error(f"Invalid job ID: {jid[:10]}")
        return False, None
    ckey = canonical_job_key(job)
    row = db.execute(
        "SELECT id FROM jobs WHERE canonical_job_key=? OR id=?",
        (ckey, jid),
    ).fetchone()
    if row:
        touch_seen(row[0], db)
        return False, ckey
    return True, ckey

# ── sanitization ──────────────────────────────────────
def sanitize(text, max_len=200):
    if not text:
        return ""
    return (
        str(text)
        .replace("{", "").replace("}", "")
        .replace("`", "").replace("\n", " ")
        .replace("\r", "").replace("\x00", "")
        .strip()
    )[:max_len]

# ── validation ────────────────────────────────────────
def validate_url(url):
    if not url or not isinstance(url, str):
        return ""
    try:
        p = urlparse(url)
        if p.scheme not in ("http", "https"):
            return ""
        if not p.netloc:
            return ""
        if p.netloc in ("localhost", "127.0.0.1", "0.0.0.0"):
            return ""
        if p.netloc.startswith(("192.168.", "10.", "172.16.")):
            return ""
        return url[:500]
    except Exception:
        return ""

def validate_job(job):
    if not isinstance(job, dict):
        return False
    if len(str(job)) > 10000:
        log.error("Job data too large")
        return False
    for v in job.values():
        if isinstance(v, str) and "\x00" in v:
            log.error("Null byte in job data")
            return False
    if not job.get("title") and not job.get("company"):
        return False
    return True

# ── alerts ────────────────────────────────────────────
def alert(msg):
    notify_system(msg)

CAREER_OPS_PIPELINE = os.environ.get("CAREER_OPS_PATH", "")


def inject_career_ops(job, score):
    if score.get("pct", 0) < 85:
        return
    pipeline_dir = os.path.dirname(CAREER_OPS_PIPELINE)
    if not os.path.exists(pipeline_dir):
        return
    try:
        line = (
            f"- [ ] {job.get('url', '')} | "
            f"{job.get('title', '')} @ "
            f"{job.get('company', '')} | "
            f"{score['pct']}%\n"
        )
        with open(CAREER_OPS_PIPELINE, "a", encoding="utf-8") as f:
            f.write(line)
        log.info(f"Career-Ops queued: {job.get('title', '')}")
    except Exception as e:
        log.error(f"Career-Ops inject: {e}", exc_info=True)


def send_excel(filepath):
    if not os.path.exists(filepath):
        log.error(f"Excel missing: {filepath}")
        return
    log.info(f"Excel ready: {filepath}")
    notify_system(f"Daily Excel ready:\n{filepath}")

# ── visa filter ───────────────────────────────────────
HARD_NO = [
    "citizen only", "clearance required", "secret clearance",
    "no visa", "no opt", "no sponsorship", "cannot sponsor",
    "will not sponsor", "must be authorized", "us citizen",
]

def visa_ok(job):
    text = " ".join([
        job.get("title", ""),
        job.get("description", ""),
        job.get("company", ""),
    ]).lower()[:5000]
    return not any(kw in text for kw in HARD_NO)

def safe_scrape(fn, name, timeout_secs=30):
    result = []
    error  = []
    def target():
        try:
            result.extend(fn() or [])
        except Exception as e:
            error.append(e)
    t = threading.Thread(target=target)
    t.start()
    t.join(timeout=timeout_secs)
    if t.is_alive():
        log.error(f"{name}: timed out")
        return []
    if error:
        log.error(f"{name}: {error[0]}", exc_info=True)
        return []
    count = len(result)
    if count == 0:
        log.warning(f"{name}: 0 jobs — site may have changed")
    else:
        log.info(f"{name}: {count} jobs")
    return result

ALERT_LOG = os.path.join(BASE, "alert_log.csv")


def log_alert(job, score):
    try:
        import csv
        exists = os.path.exists(ALERT_LOG)
        with open(ALERT_LOG, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if not exists:
                writer.writerow([
                    "timestamp", "title", "company",
                    "url", "source", "score", "notified",
                ])
            writer.writerow([
                datetime.now().isoformat(),
                job.get("title",   ""),
                job.get("company", ""),
                job.get("url",     ""),
                job.get("source",  ""),
                score.get("pct", 0),
                "yes",
            ])
    except Exception as e:
        log.error(f"Alert log error: {e}", exc_info=True)


# ── save ──────────────────────────────────────────────
def save(job, score_val, db):
    if not validate_job(job):
        log.error("Invalid job — not saving")
        return
    if not isinstance(score_val, (int, float)) or not 0 <= score_val <= 100:
        log.error(f"Invalid score: {score_val}")
        return
    check_db_size(db)
    now = datetime.now().isoformat()
    ckey = canonical_job_key(job)
    role_cat = detect_role_category(job.get("title", ""), job.get("description", ""))
    try:
        from utils.resume_variants import select_resume_variant
        variant = select_resume_variant(job)
    except Exception:
        variant = "java_backend"
    db.execute(
        """
        INSERT OR IGNORE INTO jobs (
            id, title, company, url, source, score, seen_at, date_posted,
            canonical_job_key, first_seen_at, last_seen_at, seen_count,
            apply_status, country, location_review, duplicate_of, expired,
            role_category, resume_variant
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            job_id(job),
            sanitize(job.get("title", "unknown"), 200),
            sanitize(job.get("company", "unknown"), 100),
            validate_url(job.get("url", "")),
            sanitize(job.get("source", "unknown"), 50),
            int(score_val),
            now,
            sanitize(job.get("date_posted", ""), 20),
            ckey,
            now,
            now,
            1,
            "need_to_apply",
            "US",
            sanitize(job.get("location", ""), 80),
            None,
            0,
            role_cat,
            variant,
        ),
    )
    db.commit()

# ── prescore (keyword fast-path, no OpenAI) ──────────
def prescore(job):
    text = (
        job.get("title", "") + " " +
        job.get("description", "")
    ).lower()
    HIGH = {
        "langgraph":           15,
        "crewai":              15,
        "rag pipeline":        12,
        "langsmith":           12,
        "multi-agent":         12,
        "agentic":             10,
        "llm engineer":        10,
        "large language model": 10,
        "genai":                8,
        "langchain":            8,
        "fine-tuning":          8,
        "llm":                  8,
        "ai engineer":          8,
        "vector database":      8,
        "embeddings":           6,
        "prompt engineering":   8,
    }
    return min(
        sum(p for k, p in HIGH.items() if k in text),
        100
    )

# ── scorer ────────────────────────────────────────────
PAVAN_SKILLS = (
    "LangGraph, CrewAI, LangChain, RAG pipelines, ChromaDB, FAISS, "
    "LangSmith evals, HuggingFace, QLoRA fine-tuning, PyTorch, "
    "ResNet50, EfficientNet, CLIP multimodal, XGBoost, FastAPI, "
    "Docker, Kubernetes, MLflow, GCP Vertex AI, AWS SageMaker, "
    "Apache Kafka, PySpark, MCP servers"
)

def score(job, stats):
    from utils.openai_client import complete
    rate_limiter.wait_if_needed()

    title   = sanitize(job.get("title",   ""), 200)
    company = sanitize(job.get("company", ""), 100)

    from resume_parser import get_resume_context_for_prompt, get_resume_status
    resume_text = get_resume_context_for_prompt()
    if not resume_text or len(resume_text) < 100:
        status = get_resume_status()
        log.warning(
            "Resume not loaded — skipping OpenAI score. %s",
            status.get("error", "Set APPLICANT_RESUME_PATH"),
        )
        stats.score_fail += 1
        return None

    if prescore(job) >= 40:
        from scrapers.jd_fetcher import fetch_full_jd
        full_jd = fetch_full_jd(job.get("url", ""))
        if full_jd and len(full_jd) > 200:
            description = sanitize(full_jd, 3000)
        else:
            description = sanitize(job.get("description", ""), 2000)
    else:
        description = sanitize(job.get("description", ""), 2000)
    if not description:
        description = title

    if not title:
        log.warning("Job has no title — skipping")
        stats.score_fail += 1
        return None

    prompt = (
        f"You are a strict technical recruiter.\n\n"
        f"CANDIDATE RESUME:\n{resume_text[:3000]}\n\n"
        f"JOB TITLE: {title}\n"
        f"COMPANY: {company}\n"
        f"JOB DESCRIPTION: {description[:2000]}\n\n"
        f"Return ONLY this JSON, no markdown:\n"
        f'{{"pct":<0-100>,"tier":"<GREEN|AMBER|RED>",'
        f'"gap":"<10 words max>",'
        f'"modifications":['
        f'"<bullet 1>","<bullet 2>","<bullet 3>"'
        f']}}\n\n'
        f"GREEN=75+, AMBER=50-74, RED=below 50\n"
        f"modifications = 3 specific resume bullets"
        f" the candidate must add to reach 100% match"
    )

    try:
        def _call():
            return complete(
                [{"role": "user", "content": prompt}],
                temperature=0.2,
            )

        raw = openai_cb.call(_call)

        if "```" in raw:
            parts = raw.split("```")
            raw   = parts[1] if len(parts) > 1 else parts[0]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        result = json.loads(raw)

        mods = result.get("modifications", [])
        if not isinstance(mods, list):
            mods = []
        result["modifications"] = [
            str(m) for m in mods[:3]
        ]

        if "pct" not in result or "tier" not in result:
            log.error(f"Missing keys for {title}: {raw[:80]}")
            stats.score_fail += 1
            return None
        if not isinstance(result["pct"], (int, float)):
            log.error(f"pct not a number for {title}")
            stats.score_fail += 1
            return None
        if result["tier"] not in ("GREEN", "AMBER", "RED"):
            log.error(f"Invalid tier for {title}: {result['tier']}")
            stats.score_fail += 1
            return None

        result["pct"] = int(result["pct"])
        stats.scored  += 1
        return result

    except json.JSONDecodeError as e:
        log.error(f"Bad JSON for {title}: {e}")
        stats.score_fail += 1
        return None
    except Exception as e:
        log.error(f"OpenAI error for {title}: {e}", exc_info=True)
        stats.score_fail += 1
        return None

# ── weekly cleanup check ──────────────────────────────
def maybe_cleanup(db):
    marker = os.path.join(LOG_DIR, ".last_cleanup")
    if os.path.exists(marker):
        last = datetime.fromtimestamp(os.path.getmtime(marker))
        if datetime.now() - last < timedelta(days=7):
            return
    cleanup_old_jobs(db, days=90)
    open(marker, "w").close()

# ── main ──────────────────────────────────────────────
def run():
    validate_env()
    lf    = acquire_lock()
    db    = None
    stats = RunStats()

    try:
        log.info(f"=== Run started {datetime.now().isoformat()} ===")
        if usa_only_enabled():
            log.info("Country filter: US only (USA_ONLY=true)")

        try:
            from scrapers.ats         import scrape_greenhouse, scrape_lever, scrape_ashby
            from scrapers.yc          import scrape_yc
            from scrapers.google_jobs import scrape_google_jobs
            from scrapers.indeed      import scrape_indeed
            from scrapers.linkedin    import scrape_linkedin
            from scrapers.enterprise_ats import (
                scrape_workday, scrape_smartrecruiters, scrape_icims,
                scrape_oracle, scrape_sap, scrape_eightfold,
            )
            from excel_builder        import build_excel
            from company_filter       import is_company_ok
        except ImportError as e:
            log.error(f"Scraper import failed: {e}")
            alert(f"SYSTEM ERROR: scraper import failed — {e}")
            return

        db   = get_db()
        maybe_cleanup(db)
        mig = run_migrations()
        log.info(f"DB migration: {mig}")

        ENABLE_LINKEDIN = bool(os.environ.get("APIFY_TOKEN_1", "").strip())

        jobs = (
            safe_scrape(scrape_greenhouse,  "Greenhouse",  timeout_secs=240) +
            safe_scrape(scrape_lever,       "Lever",       timeout_secs=90)  +
            safe_scrape(scrape_ashby,       "Ashby",       timeout_secs=120) +
            safe_scrape(scrape_yc,          "YC",          timeout_secs=180) +
            safe_scrape(scrape_google_jobs, "Google Jobs", timeout_secs=420) +
            safe_scrape(scrape_indeed,      "Indeed",      timeout_secs=200) +
            safe_scrape(scrape_workday,     "Workday",     timeout_secs=180) +
            safe_scrape(scrape_smartrecruiters, "SmartRecruiters", timeout_secs=120) +
            safe_scrape(scrape_icims,       "iCIMS",       timeout_secs=120) +
            safe_scrape(scrape_oracle,      "Oracle",      timeout_secs=90) +
            safe_scrape(scrape_sap,         "SAP",         timeout_secs=90) +
            safe_scrape(scrape_eightfold,   "Eightfold",   timeout_secs=90)
        )

        if ENABLE_LINKEDIN:
            jobs += safe_scrape(scrape_linkedin, "LinkedIn", timeout_secs=300)

        stats.fetched = len(jobs)
        jobs, stats.non_us_rejected = partition_us_jobs(jobs)
        stats.us_jobs = len(jobs)
        log.info(
            f"US filter: {stats.us_jobs} US jobs, "
            f"{stats.non_us_rejected} non-US rejected "
            f"(from {stats.fetched} fetched)"
        )

        if not jobs:
            msg = "SYSTEM WARNING: all scrapers returned 0 jobs"
            log.error(msg)
            alert(msg)
            return

        greens, ambers = [], []
        excel_rows = []

        def is_relevant(job):
            title = job.get("title", "").lower()
            if any(kw in title for kw in TITLE_BLOCK):
                return False
            if not any(kw in title for kw in TITLE_REQUIRE_ONE):
                return False
            text = title + " " + job.get("description", "").lower()
            return any(kw in text for kw in ALL_ROLE_KEYWORDS)

        relevant_jobs = [j for j in jobs if is_relevant(j)]
        log.info(f"Relevant jobs after keyword filter: {len(relevant_jobs)}/{len(jobs)}")

        # Pre-filter: only new, company-ok, prescore-passing jobs — then cap
        candidates = []
        for job in relevant_jobs:
            if not validate_job(job):
                continue
            if not is_company_ok(job):
                stats.skipped += 1
                continue
            is_new_job, ckey = is_new(job, db)
            if not is_new_job:
                stats.duplicates_skipped += 1
                stats.skipped += 1
                continue
            job["canonical_job_key"] = ckey
            ps = prescore(job)
            if ps < 8:
                save(job, ps, db)
                continue
            candidates.append((job, ps))

        # Sort: CPT-friendly US Remote > Hybrid > Onsite, then prescore
        candidates.sort(
            key=lambda x: (us_work_mode_priority(x[0]), x[1]),
            reverse=True,
        )
        log.info(f"Candidates after prescore gate: {len(candidates)} (processing top 20)")

        for job, _ps in candidates[:20]:
            if not visa_ok(job):
                stats.visa_block += 1
                save(job, 0, db)
                continue

            liveness = check_liveness(job.get("url", ""))
            if liveness == "expired":
                mark_expired(job, db)
                stats.expired += 1
                stats.skipped += 1
                continue

            archetype = detect_archetype(job)
            job["archetype"] = archetype
            job["legitimacy"] = score_legitimacy(job)

            result = score(job, stats)
            if result is None:
                continue

            save(job, result["pct"], db)
            inject_career_ops(job, result)

            if result["pct"] >= 50:
                excel_rows.append((job, result))
                stats.excel_rows += 1

            if result["tier"] == "GREEN":
                stats.green += 1
                greens.append((job, result))
            elif result["tier"] == "AMBER":
                stats.amber += 1
                ambers.append((job, result))
            else:
                stats.red += 1

        if greens:
            for job, r in greens[:5]:
                notify_match(job, r, visa_compatible=True)
                log_alert(job, r)

        if ambers:
            log.info(f"{stats.amber} AMBER jobs — review Excel tracker")

        if excel_rows:
            out_dir = os.path.join(BASE, "outputs")
            os.makedirs(out_dir, exist_ok=True)
            out_path = os.path.join(
                out_dir,
                f"jobs_{datetime.now().strftime('%Y-%m-%d')}.xlsx",
            )
            build_excel(excel_rows, out_path)
            log.info(f"Excel written: {out_path} ({len(excel_rows)} rows)")
            send_excel(out_path)

        summary  = stats.summary()
        degraded = stats.is_degraded()
        log.info(summary)

        if degraded:
            alert(f"SYSTEM DEGRADED: {degraded}\n\n{summary}")
            log.error(f"Degraded: {degraded}")

        log.info(f"=== Run complete {datetime.now().isoformat()} ===")

    except Exception as e:
        log.critical(f"Unhandled exception: {e}", exc_info=True)
        alert(f"CRITICAL: scraper crashed — {str(e)[:200]}")
    finally:
        if db:
            db.close()
        release_lock(lf)

if __name__ == "__main__":
    run()
