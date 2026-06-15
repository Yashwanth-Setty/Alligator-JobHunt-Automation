"""
Enterprise ATS scrapers: Workday, iCIMS, SmartRecruiters, Oracle, SAP, Eightfold.
USA filter applied before returning results.
"""
import json
import logging
import os
import re
import sys
import time
import random

import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from filters import ML_KEYWORDS, TITLE_BLOCK, JAVA_KEYWORDS
from utils.query_rotation import get_rotated_queries

log = logging.getLogger("alligator_apply")

try:
    from utils.us_filter import job_is_us, usa_only_enabled
except ImportError:
    job_is_us = lambda j: True  # noqa: E731
    usa_only_enabled = lambda: False  # noqa: E731


def _is_relevant(job: dict) -> bool:
    title = (job.get("title") or "").lower()
    desc = (job.get("description") or "").lower()
    text = title + " " + desc
    if any(b in title for b in TITLE_BLOCK):
        return False
    keywords = ML_KEYWORDS + JAVA_KEYWORDS
    return any(kw in text for kw in keywords)


def _keep_us(candidate: dict) -> bool:
    if usa_only_enabled() and not job_is_us(candidate):
        return False
    return True


def _base_job(title, company, url, source, desc="", location="", date_posted="") -> dict:
    return {
        "title": title,
        "company": company,
        "url": url,
        "source": source,
        "description": (desc or "")[:2000],
        "location": location,
        "date_posted": date_posted,
        "country": "US",
    }


# ── SmartRecruiters (public API) ─────────────────────────────────────────────
SMARTRECRUITERS_COMPANIES = [
    "Visa", "Santander", "LinkedIn", "Bosch", "Adidas", "Equinix", "SAS",
    "McDonald's", "Intuit", "Splunk", "DocuSign", "Autodesk",
    "Square", "Twilio", "Zendesk", "HubSpot", "Atlassian",
]


def scrape_smartrecruiters() -> list[dict]:
    results = []
    bucket, terms = get_rotated_queries("smartrecruiters")
    log.info(f"SmartRecruiters bucket: {bucket}")
    search = terms[0].split()[0] if terms else "engineer"
    try:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            for company in SMARTRECRUITERS_COMPANIES:
                try:
                    time.sleep(random.uniform(0.5, 1.5))
                    url = (
                        f"https://api.smartrecruiters.com/v1/companies/"
                        f"{company}/postings?limit=50"
                    )
                    r = client.get(url)
                    if r.status_code == 404:
                        continue
                    r.raise_for_status()
                    data = r.json()
                    for posting in data.get("content", []):
                        title = posting.get("name", "")
                        if search.lower() not in title.lower() and not _is_relevant({"title": title, "description": ""}):
                            if not any(t.lower() in title.lower() for t in terms):
                                continue
                        loc = posting.get("location", {}) or {}
                        location = loc.get("city", "") or loc.get("country", "") or ""
                        if isinstance(loc, dict) and loc.get("remote"):
                            location = f"{location} Remote US".strip()
                        ref = posting.get("ref", "")
                        job_url = posting.get("postingUrl") or (
                            f"https://jobs.smartrecruiters.com/{company}/{ref}" if ref else ""
                        )
                        candidate = _base_job(
                            title, company, job_url, "smartrecruiters",
                            posting.get("jobAd", {}).get("sections", {}).get("jobDescription", {}).get("text", "")[:500]
                            if isinstance(posting.get("jobAd"), dict) else "",
                            location,
                            (posting.get("releasedDate") or "")[:10],
                        )
                        if _is_relevant(candidate) and _keep_us(candidate):
                            results.append(candidate)
                except Exception as e:
                    log.debug(f"SmartRecruiters {company}: {e}")
    except Exception as e:
        log.error(f"SmartRecruiters client error: {e}")
    log.info(f"SmartRecruiters: {len(results)} jobs")
    return results


# ── Workday (CXS API) ────────────────────────────────────────────────────────
WORKDAY_SITES = [
    ("nvidia", "wd5", "nvidia", "NVIDIAExternalCareerSite"),
    ("salesforce", "wd12", "salesforce", "External_Career_Site"),
    ("adobe", "wd5", "adobe", "external_experienced"),
    ("servicenow", "wd1", "servicenow", "careers"),
    ("workday", "wd5", "workday", "Workday"),
    ("netflix", "wd1", "netflix", "External"),
    ("intuit", "wd1", "intuit", "Intuit"),
    ("paypal", "wd1", "paypal", "jobs"),
    ("visa", "wd5", "visa", "VisaCareers"),
    ("capitalone", "wd1", "capitalone", "Capital_One"),
    ("dell", "wd1", "dell", "External"),
    ("cisco", "wd1", "cisco", "Cisco_Careers"),
    ("amd", "wd1", "amd", "External"),
]


def scrape_workday() -> list[dict]:
    results = []
    bucket, terms = get_rotated_queries("workday")
    log.info(f"Workday bucket: {bucket}")
    search_text = terms[0] if terms else "Java Developer"
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            for tenant, wd, slug, site in WORKDAY_SITES:
                try:
                    time.sleep(random.uniform(1, 2))
                    host = f"https://{slug}.{wd}.myworkdayjobs.com"
                    api = f"{host}/wday/cxs/{tenant}/{site}/jobs"
                    payload = {"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": search_text}
                    r = client.post(api, json=payload, headers={"Content-Type": "application/json"})
                    if r.status_code >= 400:
                        continue
                    data = r.json()
                    for item in data.get("jobPostings", []):
                        title = item.get("title", "")
                        ext_path = item.get("externalPath", "")
                        job_url = f"{host}{ext_path}" if ext_path else ""
                        loc_data = item.get("locationsText", "") or item.get("location", "")
                        candidate = _base_job(
                            title, slug, job_url, "workday",
                            item.get("bulletFields", [""])[0] if item.get("bulletFields") else "",
                            str(loc_data),
                            (item.get("postedOn", "") or "")[:10],
                        )
                        if _is_relevant(candidate) and _keep_us(candidate):
                            results.append(candidate)
                except Exception as e:
                    log.debug(f"Workday {slug}: {e}")
    except Exception as e:
        log.error(f"Workday client error: {e}")
    log.info(f"Workday: {len(results)} jobs")
    return results


# ── Oracle Recruiting Cloud ────────────────────────────────────────────────────
ORACLE_SITES = [
    ("oracle", "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitions"),
    ("nvidia", "https://nvidia.wd5.myworkdayjobs.com"),  # fallback placeholder
]


def scrape_oracle() -> list[dict]:
    results = []
    bucket, terms = get_rotated_queries("oracle")
    log.info(f"Oracle bucket: {bucket}")
    search = (terms[0] if terms else "software engineer").lower()
    oracle_hosts = [
        ("oracle", "https://eeho.fa.us2.oraclecloud.com"),
        ("accenture", "https://accenture.wd103.myworkdayjobs.com"),  # often hybrid
    ]
    # Oracle HCM REST for Oracle itself
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            url = (
                "https://eeho.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/"
                "recruitingCEJobRequisitions?onlyData=true&limit=50"
            )
            r = client.get(url, headers={"Accept": "application/json"})
            if r.is_success:
                data = r.json()
                items = data.get("items", [])
                for item in items:
                    title = item.get("Title") or item.get("JobTitle") or ""
                    if search not in title.lower() and not _is_relevant({"title": title, "description": ""}):
                        continue
                    req_id = item.get("RequisitionId") or item.get("Id", "")
                    job_url = f"https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/{req_id}"
                    candidate = _base_job(
                        title, "oracle", job_url, "oracle",
                        item.get("ExternalDescriptionStr", "")[:500],
                        item.get("PrimaryLocation", "") or "",
                    )
                    if _is_relevant(candidate) and _keep_us(candidate):
                        results.append(candidate)
    except Exception as e:
        log.debug(f"Oracle API: {e}")

    log.info(f"Oracle: {len(results)} jobs")
    return results


# ── SAP SuccessFactors (public career search pages) ───────────────────────────
SAP_COMPANIES = [
    ("sap", "https://jobs.sap.com/search/?q=&startrow=0"),
    ("microsoft", "https://jobs.careers.microsoft.com/global/en/search?q=java"),
]


def scrape_sap() -> list[dict]:
    results = []
    bucket, terms = get_rotated_queries("sap")
    log.info(f"SAP bucket: {bucket}")
    search = terms[0] if terms else "software engineer"
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            # SAP jobs API pattern for jobs.sap.com
            url = f"https://jobs.sap.com/search/?q={httpx.URL(search).raw_path.decode() if False else search.replace(' ', '+')}&startrow=0"
            url = f"https://jobs.sap.com/search/?q={search.replace(' ', '+')}&startrow=0"
            r = client.get(url, headers={"User-Agent": "Mozilla/5.0"})
            if r.is_success:
                html = r.text
                # Extract job links from SAP career page
                for m in re.finditer(r'data-job-id="(\d+)"[^>]*>.*?<a[^>]+href="([^"]+)"[^>]*>([^<]+)</a>', html, re.S):
                    jid, href, title = m.group(1), m.group(2), m.group(3).strip()
                    if not title:
                        continue
                    job_url = href if href.startswith("http") else f"https://jobs.sap.com{href}"
                    candidate = _base_job(title, "sap", job_url, "sap", "", "US")
                    if _is_relevant(candidate) and _keep_us(candidate):
                        results.append(candidate)
                # Fallback: JSON embedded in page
                if not results:
                    for m in re.finditer(r'"title"\s*:\s*"([^"]+)"[^}]*"url"\s*:\s*"([^"]+)"', html):
                        title, job_url = m.group(1), m.group(2)
                        candidate = _base_job(title, "sap", job_url, "sap", "", "US")
                        if _is_relevant(candidate) and _keep_us(candidate):
                            results.append(candidate)
    except Exception as e:
        log.debug(f"SAP scrape: {e}")
    log.info(f"SAP: {len(results)} jobs")
    return results


# ── iCIMS (public career portals) ─────────────────────────────────────────────
ICIMS_PORTALS = [
    ("jpmorgan", "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs"),
    ("capitalone", "https://capitalone.wd1.myworkdayjobs.com/Capital_One"),
    ("comcast", "https://comcast.wd5.myworkdayjobs.com/Comcast_Careers"),
]


def scrape_icims() -> list[dict]:
    """Scrape iCIMS-hosted and similar public career portals."""
    results = []
    bucket, terms = get_rotated_queries("icims")
    log.info(f"iCIMS bucket: {bucket}")
    icims_hosts = [
        "https://careers-americas.honeywell.com/us/en/search-results",
        "https://careers.cognizant.com/global/en/search-results",
        "https://careers.fedex.com/fedex/jobs",
    ]
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            for portal_url in icims_hosts:
                try:
                    time.sleep(random.uniform(1, 2))
                    r = client.get(portal_url, headers={"User-Agent": "Mozilla/5.0"})
                    if not r.is_success:
                        continue
                    html = r.text
                    company = portal_url.split("/")[2].replace("careers.", "").split(".")[0]
                    # Generic job title + link extraction
                    for m in re.finditer(
                        r'<a[^>]+href="([^"]*(?:job|requisition|careers)[^"]*)"[^>]*>\s*([^<]{5,80})\s*</a>',
                        html, re.I,
                    ):
                        href, title = m.group(1), m.group(2).strip()
                        if any(x in title.lower() for x in ("cookie", "privacy", "login", "sign")):
                            continue
                        job_url = href if href.startswith("http") else portal_url.rsplit("/", 1)[0] + "/" + href.lstrip("/")
                        candidate = _base_job(title, company, job_url, "icims", "", "US")
                        if _is_relevant(candidate) and _keep_us(candidate):
                            results.append(candidate)
                except Exception as e:
                    log.debug(f"iCIMS portal {portal_url}: {e}")
    except Exception as e:
        log.error(f"iCIMS client error: {e}")
    log.info(f"iCIMS: {len(results)} jobs")
    return results


# ── Eightfold AI career sites ─────────────────────────────────────────────────
EIGHTFOLD_SITES = [
    ("nvidia", "https://nvidia.eightfold.ai/careers"),
    ("paypal", "https://paypal.eightfold.ai/careers"),
    ("vodafone", "https://vodafone.eightfold.ai/careers"),
    ("micron", "https://micron.eightfold.ai/careers"),
]


def scrape_eightfold() -> list[dict]:
    results = []
    bucket, terms = get_rotated_queries("eightfold")
    log.info(f"Eightfold bucket: {bucket}")
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            for company, base_url in EIGHTFOLD_SITES:
                try:
                    time.sleep(random.uniform(1, 2))
                    api = f"{base_url}/api/pcsx/search?page=1&domain={company}.eightfold.ai"
                    r = client.get(api, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})
                    if r.is_success:
                        data = r.json()
                        postings = data.get("data", {}).get("positions", []) or data.get("positions", [])
                        for pos in postings:
                            title = pos.get("name") or pos.get("title") or ""
                            job_url = pos.get("canonicalPositionUrl") or pos.get("url") or base_url
                            loc = pos.get("location") or pos.get("locations", [""])[0] if pos.get("locations") else ""
                            candidate = _base_job(title, company, job_url, "eightfold", "", str(loc))
                            if _is_relevant(candidate) and _keep_us(candidate):
                                results.append(candidate)
                        continue
                    # HTML fallback
                    r = client.get(base_url, headers={"User-Agent": "Mozilla/5.0"})
                    if r.is_success:
                        for m in re.finditer(r'"positionTitle"\s*:\s*"([^"]+)"', r.text):
                            title = m.group(1)
                            candidate = _base_job(title, company, base_url, "eightfold", "", "US")
                            if _is_relevant(candidate) and _keep_us(candidate):
                                results.append(candidate)
                except Exception as e:
                    log.debug(f"Eightfold {company}: {e}")
    except Exception as e:
        log.error(f"Eightfold client error: {e}")
    log.info(f"Eightfold: {len(results)} jobs")
    return results


def scrape_all_enterprise_ats() -> list[dict]:
    """Run all enterprise ATS scrapers."""
    return (
        scrape_workday()
        + scrape_smartrecruiters()
        + scrape_icims()
        + scrape_oracle()
        + scrape_sap()
        + scrape_eightfold()
    )
