import os, sqlite3, glob, logging
from datetime import datetime, timedelta
import utils.env_loader  # noqa: F401
from utils.notifications import notify_system

log = logging.getLogger("alligator_apply")
BASE = os.path.abspath(os.path.dirname(__file__))


def send_weekly_report():
    db_path = os.path.join(BASE, "alligator_apply.db")
    if not os.path.exists(db_path):
        log.info("No database yet")
        return

    try:
        db   = sqlite3.connect(db_path)
        rows = db.execute("""
            SELECT source, score, seen_at
            FROM jobs
            WHERE seen_at > datetime('now', '-7 days')
        """).fetchall()
        db.close()
    except Exception as e:
        log.error(f"DB error: {e}")
        return

    if not rows:
        log.info("No data for weekly report")
        return

    total_scraped = len(rows)
    scored  = [r for r in rows if r[1] and r[1] > 0]
    green   = [r for r in rows if r[1] and r[1] >= 75]
    excel   = [r for r in rows if r[1] and r[1] >= 50]

    source_counts = {}
    for r in green:
        source_counts[r[0]] = source_counts.get(r[0], 0) + 1
    best_source = (
        max(source_counts, key=source_counts.get)
        if source_counts else "none"
    )

    avg_score = (
        sum(r[1] for r in scored) / len(scored)
        if scored else 0
    )

    applied    = 0
    interviews = 0
    outputs = os.path.join(BASE, "outputs")
    files   = sorted(glob.glob(os.path.join(outputs, "*.xlsx"))) if os.path.exists(outputs) else []

    if files:
        try:
            import openpyxl
            wb = openpyxl.load_workbook(files[-1])
            ws = wb.active
            for row in range(4, ws.max_row + 1):
                status = ws.cell(row=row, column=13).value
                if str(status) == "Applied":
                    applied += 1
                if str(status) == "Interview":
                    interviews += 1
        except Exception:
            pass

    if interviews == 0 and applied > 10:
        focus = "Follow up on existing applications — 7 day rule"
    elif len(green) < 5:
        focus = "Expand keywords — not enough GREEN matches"
    elif applied < len(green) * 0.5:
        focus = "Apply faster — move quicker on matches"
    else:
        focus = "Pipeline healthy — maintain current pace"

    msg = (
        f"Weekly Alligator Apply Report\n\n"
        f"Jobs scraped: {total_scraped}\n"
        f"GREEN matches 75%+: {len(green)}\n"
        f"In Excel 50%+: {len(excel)}\n"
        f"Applied: {applied}\n"
        f"Interviews: {interviews}\n"
        f"Avg match score: {avg_score:.0f}%\n"
        f"Best source: {best_source}\n\n"
        f"Focus next week:\n{focus}"
    )

    notify_system(msg)
    log.info("Weekly report sent")
