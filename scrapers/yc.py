"""
YC / HN jobs scraper.
Uses the official Hacker News Firebase API to pull the current
"Who is Hiring?" thread — 100% open, no auth needed, no bot blocks.
"""
import httpx
import re
import logging
import sys
import os
from datetime import datetime
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    from filters import ML_KEYWORDS, TITLE_BLOCK
except Exception:
    ML_KEYWORDS = ["machine learning", "ml engineer", "ai engineer", "llm"]
    TITLE_BLOCK = []

log = logging.getLogger("alligator_apply")

try:
    from utils.us_filter import job_is_us, usa_only_enabled
except ImportError:
    job_is_us = lambda j: True
    usa_only_enabled = lambda: False

HN_API = "https://hacker-news.firebaseio.com/v0"

WHO_IS_HIRING_USER = "whoishiring"


def is_relevant(job):
    title = job.get("title", "").lower()
    desc  = job.get("description", "").lower()
    text  = title + " " + desc
    for block in TITLE_BLOCK:
        if block in title:
            return False
    return any(kw in text for kw in ML_KEYWORDS)


def _get_latest_hiring_post():
    """Find the most recent 'Who is Hiring?' story ID."""
    try:
        r = httpx.get(
            f"{HN_API}/user/{WHO_IS_HIRING_USER}.json",
            timeout=15,
        )
        r.raise_for_status()
        submitted = r.json().get("submitted", [])
        # Stories are newest-first; check the first 10 to find hiring post
        for sid in submitted[:10]:
            sr = httpx.get(f"{HN_API}/item/{sid}.json", timeout=10)
            sr.raise_for_status()
            item = sr.json()
            if (
                item
                and item.get("type") == "story"
                and "who is hiring" in (item.get("title") or "").lower()
            ):
                log.info(
                    f"YC/HN: found hiring thread: "
                    f"'{item['title']}' (id={sid})"
                )
                return sid
    except Exception as e:
        log.error(f"YC/HN: could not find hiring post: {e}")
    return None


def _parse_comment(text):
    """Strip HTML tags from HN comment text."""
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("&amp;", "&").replace("&#x27;", "'") \
               .replace("&quot;", '"').replace("&gt;", ">") \
               .replace("&lt;", "<").replace("&#x2F;", "/")
    return text.strip()


def _extract_url(text):
    """Pull first http URL from comment text."""
    m = re.search(r'https?://[^\s<>"]+', text)
    return m.group(0).rstrip(".,)") if m else ""


def _extract_title_company_location(raw):
    """
    HN comments start with:
      'CompanyName | Role | Location | ...'
    or just free-form text.
    """
    first_line = raw.split("\n")[0][:200]
    parts = [p.strip() for p in first_line.split("|")]
    if len(parts) >= 2:
        company = parts[0]
        title   = parts[1]
        location = parts[2] if len(parts) >= 3 else ""
    else:
        company = "YC Startup"
        title   = first_line[:80]
        location = ""
    return title, company, location


def scrape_yc():
    story_id = _get_latest_hiring_post()
    if not story_id:
        log.warning("YC/HN: no hiring thread found")
        return []

    try:
        r = httpx.get(f"{HN_API}/item/{story_id}.json", timeout=15)
        r.raise_for_status()
        story = r.json()
    except Exception as e:
        log.error(f"YC/HN: could not fetch story: {e}")
        return []

    kids = story.get("kids", [])
    log.info(f"YC/HN: {len(kids)} top-level comments to scan")

    results = []
    # Fetch up to 200 comments (each is one job post)
    for kid_id in kids[:200]:
        try:
            cr = httpx.get(f"{HN_API}/item/{kid_id}.json", timeout=10)
            cr.raise_for_status()
            comment = cr.json()
        except Exception:
            continue

        if not comment or comment.get("deleted") or comment.get("dead"):
            continue

        raw  = _parse_comment(comment.get("text", ""))
        if not raw:
            continue

        title, company, location = _extract_title_company_location(raw)
        url = _extract_url(raw)
        if not url:
            url = f"https://news.ycombinator.com/item?id={kid_id}"

        ts = comment.get("time", 0) or 0
        try:
            date_posted = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
        except Exception:
            date_posted = ""

        candidate = {
            "title":       title,
            "company":     company,
            "url":         url,
            "source":      "yc_hn",
            "description": raw[:2000],
            "date_posted": date_posted,
            "location":    location,
            "country":     "US",
        }
        if is_relevant(candidate):
            if usa_only_enabled() and not job_is_us(candidate):
                continue
            results.append(candidate)

    log.info(f"YC/HN: {len(results)} matching jobs")
    return results
