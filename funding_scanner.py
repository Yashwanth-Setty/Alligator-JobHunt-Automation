import os, logging
from datetime import datetime, timedelta
import utils.env_loader  # noqa: F401
from utils.notifications import notify_system

log = logging.getLogger("alligator_apply")

RSS_FEEDS = [
    "https://techcrunch.com/tag/funding/feed/",
    "https://news.ycombinator.com/rss",
]

FUNDING_KEYWORDS = [
    "raises", "raised", "funding", "series a",
    "series b", "series c", "seed round",
    "million", "billion", "backed by",
]

AI_KEYWORDS = [
    "ai", "ml", "llm", "machine learning",
    "artificial intelligence", "language model",
    "generative", "agentic", "nlp", "data",
]


def scan_funding_news():
    try:
        import feedparser
    except ImportError:
        log.error("feedparser not installed — run: pip install feedparser")
        return

    found = []
    cutoff = datetime.now() - timedelta(hours=24)

    for feed_url in RSS_FEEDS:
        try:
            feed = feedparser.parse(feed_url)
            for entry in feed.entries:
                title   = entry.get("title",   "").lower()
                summary = entry.get("summary", "").lower()
                text    = title + " " + summary

                published = entry.get("published_parsed")
                if published:
                    pub_dt = datetime(*published[:6])
                    if pub_dt < cutoff:
                        continue

                has_funding = any(k in text for k in FUNDING_KEYWORDS)
                has_ai      = any(k in text for k in AI_KEYWORDS)

                if has_funding and has_ai:
                    found.append({
                        "title":   entry.get("title", ""),
                        "link":    entry.get("link",  ""),
                        "summary": entry.get("summary", "")[:200],
                    })
        except Exception as e:
            log.error(f"Feed error {feed_url}: {e}")
            continue

    if not found:
        log.info("Funding scan: no new AI funding news")
        return

    msg = "AI Funding News Today\n\n"
    for item in found[:5]:
        msg += (
            f"{item['title'][:80]}\n"
            f"{item['summary']}\n"
            f"{item['link']}\n\n"
        )
    msg += "These companies may be hiring ML/AI engineers now"

    notify_system(msg)
    log.info(f"Funding scan: notified {len(found)} items")
