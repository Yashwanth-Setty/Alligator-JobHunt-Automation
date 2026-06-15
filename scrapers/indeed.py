import logging, time, sys, os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
try:
    from filters import ML_KEYWORDS, TITLE_BLOCK, JAVA_KEYWORDS
except Exception:
    ML_KEYWORDS = ["machine learning", "ml engineer", "ai engineer", "llm"]
    JAVA_KEYWORDS = ["java", "backend", "spring"]
    TITLE_BLOCK = []
from jobspy import scrape_jobs

log = logging.getLogger("alligator_apply")

try:
    from utils.us_filter import job_is_us, usa_only_enabled
except ImportError:
    job_is_us = lambda j: True
    usa_only_enabled = lambda: False

from utils.query_rotation import get_rotated_queries

LOCATIONS = [
    "Remote",
    "New York, NY",
    "San Francisco, CA",
    "Seattle, WA",
    "Austin, TX",
    "Chicago, IL",
    "Boston, MA",
    "Atlanta, GA",
]

def scrape_indeed():
    jobs = []
    seen = set()
    bucket, terms = get_rotated_queries("indeed")
    log.info(f"Indeed queries bucket: {bucket} ({', '.join(terms)})")
    for term in terms:
        for location in LOCATIONS:
            try:
                log.info(f"Indeed: '{term}' in '{location}'")
                time.sleep(2)
                results = scrape_jobs(
                    site_name=["indeed"],
                    search_term=term,
                    location=location,
                    results_wanted=12,
                    hours_old=72,
                    country_indeed="USA",
                )
                if results is None or results.empty:
                    continue
                for _, row in results.iterrows():
                    title = str(row.get("title", "") or "")
                    company = str(row.get("company", "") or "")
                    url = str(row.get("job_url", "") or "")
                    desc = str(row.get("description", "") or "")
                    if not title or not company:
                        continue
                    key = f"{title.lower()}|{company.lower()}"
                    if key in seen:
                        continue
                    t = title.lower()
                    text = t + " " + desc.lower()
                    if any(b in t for b in TITLE_BLOCK):
                        continue
                    if not any(kw in text for kw in ML_KEYWORDS) and not any(kw in text for kw in JAVA_KEYWORDS):
                        continue
                    raw_date = row.get("date_posted", None)
                    try:
                        date_posted = str(raw_date)[:10] if raw_date else ""
                    except Exception:
                        date_posted = ""
                    loc = str(row.get("location", "") or location)
                    seen.add(key)
                    candidate = {
                        "title": title,
                        "company": company,
                        "url": url,
                        "source": "indeed",
                        "description": desc[:500],
                        "date_posted": date_posted,
                        "location": loc,
                        "search_location": location,
                        "country": "US",
                    }
                    if usa_only_enabled() and not job_is_us(candidate):
                        continue
                    jobs.append(candidate)
            except Exception as e:
                log.error(f"Indeed error for '{term}': {e}")
                continue
    log.info(f"Indeed: {len(jobs)} total jobs")
    return jobs
