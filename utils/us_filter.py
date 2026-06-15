"""United States job location filter."""
import os
import re

COUNTRY_FILTER = os.environ.get("COUNTRY_FILTER", "US").strip().upper()

NON_US_PHRASES = [
    "canada", "toronto", "vancouver", "montreal", "ottawa",
    "morocco", "casablanca", "rabat",
    "india", "bangalore", "bengaluru", "hyderabad", "mumbai", "delhi", "pune", "chennai",
    "europe", "emea", "european union", " eu,", " eu ",
    "united kingdom", " uk,", " uk ", "u.k.", "england", "scotland", "london, uk",
    "germany", "berlin", "munich", "frankfurt",
    "australia", "sydney", "melbourne", "brisbane",
    "singapore",
    "latam", "latin america", "são paulo", "sao paulo", "mexico city",
    "apac", "asia-pacific", "asia pacific",
    "japan", "tokyo", "osaka",
    "china", "beijing", "shanghai", "shenzhen",
    "south korea", "seoul",
    "netherlands", "amsterdam",
    "france", "paris",
    "ireland", "dublin",
    "israel", "tel aviv",
    "switzerland", "zurich",
    "spain", "madrid", "barcelona",
    "italy", "rome", "milan",
    "poland", "warsaw",
    "portugal", "lisbon",
    "sweden", "stockholm",
    "norway", "oslo",
    "denmark", "copenhagen",
    "belgium", "brussels",
    "austria", "vienna",
    "czech", "prague",
    "romania", "bucharest",
    "hungary", "budapest",
    "argentina", "buenos aires",
    "colombia", "bogotá", "bogota",
    "chile", "santiago",
    "philippines", "manila",
    "indonesia", "jakarta",
    "vietnam", "ho chi minh",
    "thailand", "bangkok",
    "malaysia", "kuala lumpur",
    "taiwan", "taipei",
    "hong kong",
    "new zealand", "auckland",
    "south africa", "cape town", "johannesburg",
    "nigeria", "lagos",
    "egypt", "cairo",
    "turkey", "istanbul",
    "uae", "dubai", "abu dhabi",
    "saudi arabia", "riyadh",
    "pakistan", "karachi", "lahore",
    "bangladesh", "dhaka",
]

US_PHRASES = [
    "united states", "united states of america", "usa", "u.s.a", "u.s.",
    "us-only", "us only", "usa only", "us remote", "remote us", "remote (us)",
    "remote - united states", "remote - us", "remote usa", "remote, us",
    "remote in us", "remote in the us", "remote within us", "remote within the us",
    "us based", "us-based", "based in us", "based in the us",
    "anywhere in the us", "anywhere in us",
]

US_STATE_NAMES = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york", "north carolina",
    "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
    "rhode island", "south carolina", "south dakota", "tennessee", "texas",
    "utah", "vermont", "virginia", "washington", "west virginia",
    "wisconsin", "wyoming", "district of columbia", "washington dc",
    "washington, dc", "dc metro",
]

US_STATE_ABBREVS = {
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
    "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
    "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
    "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
    "wi", "wy", "dc",
}

US_CITY_HINTS = [
    "san francisco", "seattle", "new york", "nyc", "austin", "boston",
    "chicago", "los angeles", "denver", "atlanta", "dallas", "houston",
    "miami", "phoenix", "portland", "san diego", "san jose", "palo alto",
    "mountain view", "menlo park", "redmond", "cambridge", "pittsburgh",
    "philadelphia", "detroit", "minneapolis", "salt lake", "raleigh",
    "charlotte", "nashville", "columbus", "indianapolis", "kansas city",
    "st louis", "baltimore", "richmond", "tampa", "orlando", "las vegas",
    "santa monica", "irvine", "sunnyvale", "cupertino", "bellevue",
]

_CITY_STATE_RE = re.compile(
    r"\b([A-Za-z][A-Za-z\s\.]+),\s*([A-Z]{2})\b"
)
_STATE_ABBREV_RE = re.compile(
    r"\b(" + "|".join(sorted(US_STATE_ABBREVS, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)


def usa_only_enabled() -> bool:
    if COUNTRY_FILTER and COUNTRY_FILTER != "US":
        return False
    return os.environ.get("USA_ONLY", "true").lower() in ("true", "1", "yes")


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _contains_phrase(text: str, phrases: list[str]) -> bool:
    for phrase in phrases:
        if phrase in text:
            return True
    return False


def _has_non_us_marker(text: str) -> bool:
    if _contains_phrase(text, NON_US_PHRASES):
        return True
    if re.search(r"\b(uk|eu)\b", text):
        return True
    if re.search(r"\b(in|at|from)\s+(canada|india|uk|germany|australia)\b", text):
        return True
    return False


def _has_us_marker(text: str) -> bool:
    if _contains_phrase(text, US_PHRASES):
        return True
    if _contains_phrase(text, US_STATE_NAMES):
        return True
    if _contains_phrase(text, US_CITY_HINTS):
        return True
    if _CITY_STATE_RE.search(text):
        return True
    for match in _STATE_ABBREV_RE.finditer(text):
        abbr = match.group(1).lower()
        if abbr in US_STATE_ABBREVS:
            return True
    return False


def _worldwide_without_us(text: str) -> bool:
    worldwide = any(
        w in text
        for w in (
            "worldwide", "global remote", "global role",
            "anywhere in the world", "global ", "world-wide",
        )
    )
    if not worldwide:
        return False
    return not _has_us_marker(text)


def is_us_job(
    location: str = "",
    description: str = "",
    metadata: dict | None = None,
) -> bool:
    """
    Return True if the job is US-based or US-remote eligible.
    Rejects explicit non-US locations; preserves remote US roles.
    """
    if not usa_only_enabled():
        return True

    metadata = metadata or {}
    parts = [
        location or "",
        description or "",
        metadata.get("title", ""),
        metadata.get("company", ""),
        metadata.get("country", ""),
        metadata.get("search_location", ""),
    ]
    text = _normalize(" ".join(parts))

    if not text:
        return False

    if _worldwide_without_us(text):
        return False

    if _has_non_us_marker(text):
        return False

    if _has_us_marker(text):
        return True

    # Remote with no non-US markers — allow (Indeed/LinkedIn US searches)
    if "remote" in text:
        return True

    # US-targeted search context from jobspy
    search_loc = _normalize(metadata.get("search_location", ""))
    if search_loc:
        if _has_us_marker(search_loc) or search_loc == "remote":
            return True

    # LinkedIn US search results
    if metadata.get("source") == "linkedin" and metadata.get("country") in ("US", "USA"):
        return True

    return False


def job_is_us(job: dict) -> bool:
    return is_us_job(
        location=job.get("location", ""),
        description=job.get("description", ""),
        metadata={
            "title":           job.get("title", ""),
            "company":         job.get("company", ""),
            "country":         job.get("country", ""),
            "search_location": job.get("search_location", ""),
            "source":          job.get("source", ""),
        },
    )


def partition_us_jobs(jobs: list) -> tuple[list, int]:
    """Split jobs into US-only list and rejected count."""
    if not usa_only_enabled():
        return jobs, 0
    us_jobs = []
    rejected = 0
    for job in jobs:
        if job_is_us(job):
            us_jobs.append(job)
        else:
            rejected += 1
    return us_jobs, rejected


def us_work_mode_priority(job: dict) -> int:
    """
    CPT-friendly sort: prefer US Remote > Hybrid US > Onsite US.
    Higher value = higher priority.
    """
    text = _normalize(
        f"{job.get('location', '')} {job.get('description', '')} "
        f"{job.get('title', '')}"
    )
    if "remote" in text:
        return 3
    if "hybrid" in text:
        return 2
    if any(k in text for k in ("onsite", "on-site", "on site", "in-office", "in office")):
        return 1
    if _has_us_marker(text):
        return 1
    return 0


def classify_usa_job(location: str = "", description: str = "") -> str:
    """
    Classify job for dashboard display.
    Returns: 'usa' | 'non_us' | 'needs_review'
    """
    text = _normalize(f"{location} {description}")
    loc = _normalize(location)

    if not text.strip():
        return "needs_review"

    if _worldwide_without_us(text):
        return "non_us"

    if _has_non_us_marker(text):
        return "non_us"

    if _has_us_marker(text):
        return "usa"

    # Remote only — must explicitly mention US
    if "remote" in text:
        us_remote = any(
            p in text
            for p in (
                "remote us", "remote usa", "remote - us", "remote (us)",
                "remote united states", "us remote", "usa remote",
                "united states remote", "remote, us",
            )
        )
        if us_remote:
            return "usa"
        return "needs_review"

    # Ambiguous short location
    if len(loc) < 3:
        return "needs_review"

    return "needs_review"


def is_usa_job(location: str = "", description: str = "") -> bool:
    """True only when location is confirmed United States."""
    return classify_usa_job(location, description) == "usa"
