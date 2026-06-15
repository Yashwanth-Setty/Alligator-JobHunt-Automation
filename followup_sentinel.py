import os, glob, logging
from datetime import datetime, timedelta
import utils.env_loader  # noqa: F401
from utils.notifications import notify_system
from utils.openai_client import complete

log = logging.getLogger("alligator_apply")

BASE = os.path.abspath(os.path.dirname(__file__))


def check_followups():
    try:
        import openpyxl
    except ImportError:
        log.error("openpyxl not installed")
        return

    outputs = os.path.join(BASE, "outputs")
    if not os.path.exists(outputs):
        log.info("No outputs folder yet")
        return

    files = sorted(glob.glob(os.path.join(outputs, "*.xlsx")))
    if not files:
        log.info("No Excel files found")
        return

    latest = files[-1]
    log.info(f"Checking followups in {latest}")

    try:
        wb = openpyxl.load_workbook(latest)
        ws = wb.active
    except Exception as e:
        log.error(f"Excel read error: {e}")
        return

    headers = {}
    for col in range(1, ws.max_column + 1):
        val = ws.cell(row=3, column=col).value
        if val:
            headers[str(val).strip()] = col

    date_col    = headers.get("Date Found", 1)
    company_col = headers.get("Company", 3)
    title_col   = headers.get("Job Title", 4)
    status_col  = headers.get("Status", 13)

    followups = []
    cutoff = datetime.now() - timedelta(days=7)

    for row in range(4, ws.max_row + 1):
        status = ws.cell(row=row, column=status_col).value
        if str(status).strip() != "Applied":
            continue

        date_val = ws.cell(row=row, column=date_col).value
        if not date_val:
            continue

        try:
            if isinstance(date_val, str):
                date_val = datetime.fromisoformat(date_val[:19])
            if date_val > cutoff:
                continue
        except Exception:
            continue

        company = ws.cell(row=row, column=company_col).value or "Unknown"
        title   = ws.cell(row=row, column=title_col).value  or "Unknown"
        days    = (datetime.now() - date_val).days

        followups.append({
            "company": str(company),
            "title":   str(title),
            "days":    days,
        })

    if not followups:
        log.info("No followups needed")
        return

    log.info(f"Found {len(followups)} applications needing followup")

    for item in followups[:5]:
        draft = _draft_followup(item["title"], item["company"], item["days"])
        msg = (
            f"Follow-up needed\n\n"
            f"{item['title']} @ {item['company']}\n"
            f"Applied {item['days']} days ago\n\n"
            f"Draft message:\n{draft}"
        )
        notify_system(msg)


def _draft_followup(title, company, days):
    if not os.environ.get("OPENAI_API_KEY"):
        return (
            f"Hi, I wanted to follow up on my application for the {title} role. "
            f"I remain very interested and would love to hear about next steps. Thank you."
        )
    try:
        return complete(
            [{"role": "user", "content": (
                f"Write a short professional follow-up email for a job application. "
                f"Role: {title}. Company: {company}. Days since applied: {days}. "
                f"Under 80 words. Sound human, not AI-generated. No subject line needed."
            )}],
            temperature=0.7,
        )[:500]
    except Exception as e:
        log.error(f"OpenAI followup error: {e}")
        return (
            f"Hi, I wanted to follow up on my {title} application at {company}. "
            f"Still very interested — would love to hear about next steps. Thank you."
        )
