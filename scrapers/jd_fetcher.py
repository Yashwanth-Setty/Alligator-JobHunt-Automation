import logging
import httpx
from bs4 import BeautifulSoup

log = logging.getLogger("alligator_apply")

_STRIP_TAGS = {"script", "style", "nav", "header", "footer", "aside", "noscript"}


def fetch_full_jd(url: str, max_chars: int = 5000) -> str:
    if not url or not url.startswith("http"):
        return ""
    try:
        with httpx.Client(
            timeout=15,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; JobHunt/1.0)"},
        ) as client:
            r = client.get(url)
            r.raise_for_status()

        soup = BeautifulSoup(r.text, "html.parser")
        for tag in soup.find_all(_STRIP_TAGS):
            tag.decompose()

        text = soup.get_text(separator="\n")
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        result = "\n".join(lines)
        return result[:max_chars]

    except httpx.TimeoutException:
        log.debug(f"jd_fetcher timeout: {url}")
        return ""
    except Exception as e:
        log.debug(f"jd_fetcher error ({url}): {e}")
        return ""
