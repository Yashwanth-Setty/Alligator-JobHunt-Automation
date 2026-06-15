import os, time, requests, logging
import utils.env_loader  # noqa: F401

try:
    from utils.us_filter import job_is_us, usa_only_enabled
except ImportError:
    job_is_us = lambda j: True
    usa_only_enabled = lambda: False

log = logging.getLogger("alligator_apply")
from utils.query_rotation import get_rotated_queries

APIFY_TOKEN = os.environ.get("APIFY_TOKEN_1", "")
ACTOR_ID    = "hKByXkMQaC5Qt9UMN"  # curious_coder/linkedin-jobs-scraper

BASE_URL = "https://www.linkedin.com/jobs/search/"
SEARCHES = []


def _search_url(query):
    from urllib.parse import urlencode
    params = {
        "keywords": query,
        "location": "United States",
        "f_TPR":    "r604800",  # last 7 days
    }
    return BASE_URL + "?" + urlencode(params)


def scrape_linkedin():
    if not APIFY_TOKEN:
        log.warning("APIFY_TOKEN_1 not set — LinkedIn skipped")
        return []
    try:
        bucket, queries = get_rotated_queries("linkedin")
        log.info(f"LinkedIn queries bucket: {bucket} ({', '.join(queries)})")
        run = requests.post(
            f"https://api.apify.com/v2/acts/{ACTOR_ID}/runs",
            headers={"Authorization": f"Bearer {APIFY_TOKEN}"},
            json={
                "urls":            [_search_url(q) for q in queries],
                "maxJobs":         50,
                "scrapeCompany":   True,
                "splitByLocation": False,
            },
            timeout=30,
        )
        if not run.ok:
            log.error(f"LinkedIn run failed: {run.status_code} {run.text[:100]}")
            return []
        run_id  = run.json()["data"]["id"]
        results = _wait_for_run(run_id)
        jobs = []
        for item in results:
            title = item.get("title", "")
            if not title:
                continue
            candidate = {
                "title":       title,
                "company":     item.get("companyName", ""),
                "url":         item.get("applyUrl", "") or item.get("link", ""),
                "source":      "linkedin",
                "description": item.get("descriptionText", title),
                "date_posted": item.get("postedAt", ""),
                "location":    item.get("location", ""),
                "country":     "US",
            }
            if usa_only_enabled() and not job_is_us(candidate):
                continue
            jobs.append(candidate)
        log.info(f"LinkedIn: {len(jobs)} jobs")
        return jobs
    except Exception as e:
        log.error(f"LinkedIn scrape error: {e}", exc_info=True)
        return []


def _wait_for_run(run_id, max_wait=240):
    url     = f"https://api.apify.com/v2/actor-runs/{run_id}"
    elapsed = 0
    while elapsed < max_wait:
        time.sleep(10)
        elapsed += 10
        try:
            r      = requests.get(
                url,
                headers={"Authorization": f"Bearer {APIFY_TOKEN}"},
                timeout=15,
            )
            status = r.json()["data"]["status"]
            if status == "SUCCEEDED":
                return _fetch_results(run_id)
            if status in ("FAILED", "ABORTED"):
                log.error(f"LinkedIn run {run_id} {status}")
                return []
        except Exception:
            pass
    log.error(f"LinkedIn run {run_id} timed out after {max_wait}s")
    return []


def _fetch_results(run_id):
    try:
        r = requests.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}/dataset/items",
            headers={"Authorization": f"Bearer {APIFY_TOKEN}"},
            params={"format": "json", "limit": 50},
            timeout=15,
        )
        return r.json() if r.ok else []
    except Exception:
        return []
