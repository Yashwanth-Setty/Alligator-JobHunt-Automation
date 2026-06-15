import re

HARD_EXPIRED = [
    "job is no longer available",
    "position has been filled",
    "no longer accepting applications",
    "this job has expired",
    "posting has been removed",
    "not currently hiring",
    "job listing has been removed",
]

APPLY_SIGNALS = [
    r"\bapply now\b",
    r"\bsubmit application\b",
    r"\bsubmit your application\b",
    r"\bapply\b",
]


def check_liveness(url) -> str:
    if not url or not isinstance(url, str):
        return "unknown"

    try:
        import httpx

        response = httpx.get(
            url,
            timeout=8.0,
            follow_redirects=True,
        )

        if response.status_code in (404, 410):
            return "expired"

        body = response.text or ""
        if len(body) < 300:
            return "expired"

        text = body.lower()
        if any(pattern in text for pattern in HARD_EXPIRED):
            return "expired"

        for pattern in APPLY_SIGNALS:
            if re.search(pattern, body, re.IGNORECASE):
                return "active"

        return "uncertain"
    except Exception:
        return "unknown"
