import os, csv, logging
from datetime import datetime, timedelta
import utils.env_loader  # noqa: F401
from utils.notifications import notify_system

log            = logging.getLogger("alligator_apply")
BASE           = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALERT_LOG      = os.path.join(BASE, "alert_log.csv")


def load_alerts_sent(days=1):
    if not os.path.exists(ALERT_LOG):
        return []
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    alerts = []
    try:
        with open(ALERT_LOG, "r", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("timestamp", "") > cutoff:
                    alerts.append(row)
    except Exception as e:
        log.error(f"Alert log read: {e}")
    return alerts


def cross_reference(alerts_sent, worker_claims):
    sent     = {a["company"].lower().strip() for a in alerts_sent}
    claimed  = {c.lower().strip() for c in worker_claims}
    verified = sent & claimed
    missing  = sent - claimed
    return {
        "sent":       len(sent),
        "claimed":    len(claimed),
        "verified":   len(verified),
        "missing":    list(missing),
        "compliance": round(
            len(verified) / max(len(sent), 1) * 100
        ),
    }


def send_audit_report(report):
    missing_str = "\n".join(
        f"- {c}" for c in report["missing"][:10]
    ) or "None"
    msg = (
        f"Daily Audit Report\n\n"
        f"Alerts sent: {report['sent']}\n"
        f"Worker claimed: {report['claimed']}\n"
        f"Verified: {report['verified']}\n"
        f"Compliance: {report['compliance']}%\n\n"
        f"Not applied to:\n{missing_str}"
    )
    notify_system(msg)


if __name__ == "__main__":
    alerts        = load_alerts_sent(days=1)
    worker_claims = []
    report        = cross_reference(alerts, worker_claims)
    send_audit_report(report)
