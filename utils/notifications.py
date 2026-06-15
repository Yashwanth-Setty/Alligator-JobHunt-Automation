"""Local notifications: console output + optional Windows desktop toasts."""
import logging
import os
import sys

log = logging.getLogger("alligator_apply")

_DESKTOP_ENABLED = os.environ.get(
    "ENABLE_DESKTOP_NOTIFICATIONS", "true"
).lower() in ("true", "1", "yes")


def _safe_print(msg: str) -> None:
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode(sys.stdout.encoding or "utf-8", errors="replace").decode(
            sys.stdout.encoding or "utf-8", errors="replace"
        ))


def _desktop_notify(title: str, message: str) -> None:
    if not _DESKTOP_ENABLED:
        return
    try:
        from win10toast import ToastNotifier

        ToastNotifier().show_toast(
            title,
            message[:256],
            duration=10,
            threaded=True,
        )
    except ImportError:
        log.debug("win10toast not installed — console only")
    except Exception as e:
        log.warning("Desktop notification failed: %s", e)


def notify_system(msg: str) -> None:
    """Print a system-level alert and optionally show a desktop toast."""
    _safe_print(msg)
    log.info(msg.replace("\n", " | "))
    first_line = msg.strip().split("\n", 1)[0]
    _desktop_notify("Alligator Apply", first_line[:256])


def notify_match(job: dict, score: dict, visa_compatible: bool = True) -> None:
    """Print a formatted job-match alert."""
    company = job.get("company", "?")
    role = job.get("title", "?")
    pct = score.get("pct", 0)
    url = job.get("url", "")
    visa = "Compatible" if visa_compatible else "Review required"

    msg = (
        "\n"
        "🐊 ALLIGATOR APPLY\n"
        "NEW MATCH FOUND\n"
        f"Company: {company}\n"
        f"Role: {role}\n"
        f"Match %: {pct}\n"
        f"Visa Compatibility: {visa}\n"
        f"Apply URL: {url}\n"
    )
    _safe_print(msg)
    log.info("GREEN match: %s @ %s (%s%%)", role, company, pct)
    _desktop_notify(
        "🐊 Alligator Apply — New Match",
        f"{company}: {role} ({pct}%)",
    )
