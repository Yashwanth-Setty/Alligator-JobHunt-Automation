import os
import sys
import json
import time
import logging
import subprocess
from datetime import datetime, timedelta
from logging.handlers import RotatingFileHandler
import utils.env_loader  # noqa: F401
from utils.notifications import notify_system

try:
    from funding_scanner import scan_funding_news
except Exception:
    scan_funding_news = None

try:
    from followup_sentinel import check_followups
except Exception:
    check_followups = None

try:
    from weekly_report import send_weekly_report
except Exception:
    send_weekly_report = None

try:
    from agents.ashby_agent import AshbyAgent
except Exception:
    AshbyAgent = None

try:
    from agents.linkedin_agent import LinkedInAgent
except Exception:
    LinkedInAgent = None

# ── paths ─────────────────────────────────────────────────
BASE       = os.path.abspath(os.path.dirname(__file__))
LOG_DIR    = os.path.join(BASE, "logs")
STATE_FILE = os.path.join(BASE, "last_run.json")

os.makedirs(LOG_DIR, exist_ok=True)

# ── logging ───────────────────────────────────────────────
log = logging.getLogger("scheduler")
log.setLevel(logging.INFO)
log.addHandler(RotatingFileHandler(
    os.path.join(LOG_DIR, "scheduler.log"),
    maxBytes=5_000_000,
    backupCount=3,
))
log.addHandler(logging.StreamHandler(sys.stdout))

# ── schedule: Mon–Fri, EST/EDT ────────────────────────────
WINDOWS         = [7, 9, 12, 16]  # kept for missed-window catchup
LINKEDIN_HOURS  = [8]             # once daily at 8am EST

# ── Eastern timezone (Python 3.9+ built-in; fallback = local) ─
try:
    from zoneinfo import ZoneInfo
    _EASTERN = ZoneInfo("America/New_York")
    def now_eastern():
        return datetime.now(_EASTERN).replace(tzinfo=None)
except ImportError:
    # Older Python or missing tzdata — assume server is in Eastern time
    def now_eastern():
        return datetime.now()

# ── state ─────────────────────────────────────────────────
def load_state():
    try:
        if os.path.exists(STATE_FILE):
            state = json.load(open(STATE_FILE))
            if not isinstance(state, dict):
                state = {}
            if "last_ashby" not in state:
                state["last_ashby"] = ""
            return state
    except Exception:
        pass
    return {"last_ashby": ""}

def save_state(state):
    try:
        json.dump(state, open(STATE_FILE, "w"))
    except Exception as e:
        log.error(f"Could not save state: {e}")

def load_last_run():
    state = load_state()
    try:
        return datetime.fromisoformat(state["last_run"])
    except Exception:
        return datetime.min

def save_last_run():
    state = load_state()
    state["last_run"]    = datetime.now().isoformat()
    state["last_window"] = now_eastern().strftime("%H:%M")
    save_state(state)

def minutes_since(key, state):
    val = state.get(key)
    if not val:
        return 9999
    try:
        return (
            datetime.now() - datetime.fromisoformat(val)
        ).total_seconds() / 60
    except Exception:
        return 9999


def run_agent(AgentClass, key, state):
    try:
        AgentClass().run()
    except Exception as e:
        log.error(f"{AgentClass.__name__} failed: {e}")
    state[key] = datetime.now().isoformat()
    save_state(state)


def should_run_task(key, target_hour, state):
    now = datetime.now()
    if now.hour < target_hour:
        return False
    last = state.get(key)
    if not last:
        return True
    try:
        last_dt = datetime.fromisoformat(last)
        if last_dt.date() < now.date():
            return True
        return False
    except Exception:
        return True


def build_daily_excel(state):
    """Query today's GREEN/AMBER jobs from DB and send the daily Excel file."""
    try:
        import sqlite3
        from datetime import date
        from excel_builder import build_excel

        db_path = os.path.join(BASE, "jobs.db")
        if not os.path.exists(db_path):
            log.warning("build_daily_excel: jobs.db not found")
            return

        today = date.today().isoformat()
        db    = sqlite3.connect(db_path)
        rows  = db.execute(
            "SELECT title, company, url, source, score, date_posted "
            "FROM jobs WHERE score >= 70 AND seen_at >= ? ORDER BY score DESC",
            (today,),
        ).fetchall()
        db.close()

        if not rows:
            log.info("build_daily_excel: no GREEN/AMBER jobs today")
            state["last_daily_excel"] = datetime.now().isoformat()
            save_state(state)
            return

        excel_rows = []
        for title, company, url, source, score, date_posted in rows:
            job = {
                "title":       title,
                "company":     company,
                "url":         url,
                "source":      source,
                "date_posted": date_posted or "",
                "archetype":   "",
                "legitimacy":  "",
            }
            tier = "GREEN" if score >= 85 else "AMBER"
            result = {
                "pct":           score,
                "tier":          tier,
                "gap":           "",
                "modifications": [],
            }
            excel_rows.append((job, result))

        out_path = os.path.join(BASE, "outputs", f"jobs_{today}.xlsx")
        build_excel(excel_rows, out_path)

        # Notify locally
        try:
            sys.path.insert(0, BASE)
            from main import send_excel
            send_excel(out_path)
        except Exception as e:
            log.error(f"build_daily_excel send_excel error: {e}")

        log.info(f"Daily Excel built: {len(excel_rows)} jobs")
    except Exception as e:
        log.error(f"build_daily_excel error: {e}")

    state["last_daily_excel"] = datetime.now().isoformat()
    save_state(state)


def run_end_of_day_review(state):
    """Run /audit-today and /review-top-jobs via claude CLI at end of day."""
    log.info("Running end of day review")
    commands = ["/audit-today", "/review-top-jobs"]
    for cmd in commands:
        try:
            result = subprocess.run(
                ["claude", "--print", cmd],
                cwd=BASE,
                capture_output=False,
                timeout=120,
            )
            if result.returncode != 0:
                log.error(f"Claude command failed: {cmd}")
            time.sleep(10)
        except FileNotFoundError:
            log.error(
                "claude CLI not found — install with: "
                "npm install -g @anthropic-ai/claude-code"
            )
            break
        except Exception as e:
            log.error(f"End of day review error ({cmd}): {e}")
    state["last_eod_review"] = datetime.now().isoformat()
    save_state(state)


# ── window helpers ────────────────────────────────────────
def windows_today(ref):
    """All scheduled window datetimes for ref's calendar date."""
    return [
        ref.replace(hour=h, minute=0, second=0, microsecond=0)
        for h in WINDOWS
    ]

def get_missed_windows(now, last_run):
    """Windows that have already passed today but weren't run."""
    return [
        w for w in windows_today(now)
        if w <= now and w > last_run
    ]

def compute_next_window(now):
    """Next scheduled window strictly after now, skipping weekends."""
    # Remaining windows today
    for w in windows_today(now):
        if w > now:
            return w

    # No more windows today — advance to next weekday
    candidate = (now + timedelta(days=1)).replace(
        hour=WINDOWS[0], minute=0, second=0, microsecond=0
    )
    while candidate.weekday() >= 5:  # 5=Saturday, 6=Sunday
        candidate += timedelta(days=1)
    return candidate

def _sleep_to(target):
    """Sleep in 5-minute chunks until target datetime.
    Short chunks let the process respond to OS signals and
    handle DST transitions or server wake-from-sleep correctly.
    """
    while True:
        remaining = (target - now_eastern()).total_seconds()
        if remaining <= 0:
            break
        chunk = min(remaining, 300)  # max 5 minutes per sleep
        time.sleep(chunk)

def sleep_until_monday(now):
    """Block until next Monday 07:00 EST."""
    days_ahead = 7 - now.weekday()  # Mon=0 … Sun=6 → Sat=2 ahead, Sun=1 ahead
    if days_ahead == 7:
        days_ahead = 0  # safety: already Monday
    monday = (now + timedelta(days=days_ahead)).replace(
        hour=WINDOWS[0], minute=0, second=0, microsecond=0
    )
    log.info(
        f"Weekend — sleeping until Monday "
        f"{monday.strftime('%Y-%m-%d %H:%M')} EST"
    )
    _sleep_to(monday)

# ── runner ────────────────────────────────────────────────
def run_main():
    script = os.path.join(BASE, "main.py")
    log.info("=== Scheduler triggering run ===")
    result = subprocess.run(
        [sys.executable, script],
        capture_output=False,
    )
    if result.returncode != 0:
        log.error(
            f"main.py exited with code "
            f"{result.returncode}"
        )
    else:
        log.info("=== Run complete ===")

def send_startup_alert(next_window):
    last_run = load_last_run()
    last_str = (
        last_run.strftime("%Y-%m-%d %H:%M")
        if last_run != datetime.min
        else "Never"
    )
    msg = (
        f"Alligator Apply Agent started\n"
        f"Next window: {next_window.strftime('%Y-%m-%d %H:%M')} EST\n"
        f"Last run: {last_str}"
    )
    log.info(msg)
    notify_system(msg)

# ── main loop ─────────────────────────────────────────────
def main_loop():
    now         = now_eastern()
    next_window = compute_next_window(now)
    send_startup_alert(next_window)

    last_checked = datetime.min

    while True:
        now = now_eastern()

        # ── detect wake from sleep ─────────────────────────
        gap = (now - last_checked).total_seconds()
        if gap > 120 and last_checked != datetime.min:
            log.info(
                f"PC woke from sleep "
                f"(gap: {gap/60:.1f} min) "
                f"— checking missed windows"
            )
        last_checked = now

        # ── Weekend guard ──────────────────────────────────
        if now.weekday() >= 5:
            log.info("Weekend — no scraping")
            sleep_until_monday(now)
            continue

        # ── Catchup: run for any missed windows ────────────
        last_run = load_last_run()
        missed   = get_missed_windows(now, last_run)

        if missed:
            labels = [w.strftime("%H:%M") for w in missed]
            log.info(
                f"Missed {len(missed)} window(s) "
                f"({', '.join(labels)}) — running now"
            )
            run_main()
            save_last_run()

        # ── Side tasks ─────────────────────────────────────
        state = load_state()

        if scan_funding_news and should_run_task("last_funding", 8, state):
            try:
                scan_funding_news()
            except Exception as e:
                log.error(f"Funding scan error: {e}")
            state["last_funding"] = datetime.now().isoformat()
            save_state(state)

        if check_followups and now.weekday() in (1, 3):
            if should_run_task("last_followup", 11, state):
                try:
                    check_followups()
                except Exception as e:
                    log.error(f"Followup check error: {e}")
                state["last_followup"] = datetime.now().isoformat()
                save_state(state)

        if send_weekly_report and now.weekday() == 6:
            if should_run_task("last_weekly", 19, state):
                try:
                    send_weekly_report()
                except Exception as e:
                    log.error(f"Weekly report error: {e}")
                state["last_weekly"] = datetime.now().isoformat()
                save_state(state)

        if should_run_task("last_daily_excel", 18, state):
            build_daily_excel(state)

        if should_run_task("last_eod_review", 18, state):
            run_end_of_day_review(state)

        # ── ATS 10-min tick + LinkedIn 3x daily ───────────
        state = load_state()

        if minutes_since("last_ats_run", state) >= 10:
            run_main()
            save_last_run()
            state["last_ats_run"] = datetime.now().isoformat()
            save_state(state)

        if AshbyAgent and minutes_since("last_ashby", state) >= 10:
            run_agent(AshbyAgent, "last_ashby", state)

        now = now_eastern()
        if (LinkedInAgent and
                now.hour in LINKEDIN_HOURS and
                minutes_since("last_linkedin", state) >= 55):
            run_agent(LinkedInAgent, "last_linkedin", state)

        log.info("Sleeping 10 min before next check")
        time.sleep(600)

# ── windows autostart ─────────────────────────────────────
def setup_windows_autostart():
    """
    Creates a Windows Task Scheduler entry
    that runs scheduler.py on login.
    Run once with: python scheduler.py --setup
    """
    if os.name != "nt":
        log.info("Not on Windows — autostart skipped (use: python3 scheduler.py &)")
        return

    script   = os.path.abspath(__file__)
    python   = sys.executable
    work_dir = os.path.dirname(script)

    task_xml = f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
    <TimeTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions>
    <Exec>
      <Command>{python}</Command>
      <Arguments>"{script}"</Arguments>
      <WorkingDirectory>{work_dir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>"""

    xml_path = os.path.join(work_dir, "alligator_apply_task.xml")
    open(xml_path, "w").write(task_xml)
    os.system(
        f'schtasks /create /tn "JobHunt" '
        f'/xml "{xml_path}" /f'
    )
    log.info("Windows autostart configured")
    print("Done. JobHunt will start on login.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--setup":
        setup_windows_autostart()
    else:
        main_loop()
