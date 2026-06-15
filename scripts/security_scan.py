"""Pre-publication secret scan — run before git commit."""
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATTERNS = [
    (r"sk-proj-[A-Za-z0-9_-]{20,}", "OpenAI API key"),
    (r"sk-[A-Za-z0-9]{20,}", "OpenAI API key"),
    (r"apify_api_[A-Za-z0-9]+", "Apify token"),
    (r"tvly-[A-Za-z0-9_-]+", "Tavily API key"),
    (r"yashwanthsetty\d*@gmail\.com", "Personal email"),
    (r"312-539-4581", "Personal phone"),
    (r"YASHWANTH SETTY", "Personal name in resume cache"),
    (r"C:\\Users\\setty\\", "Local user path"),
    (r"C:\\Users\\pavan\\", "Legacy user path"),
]

IGNORE_DIRS = {".git", "__pycache__", "venv", ".venv", "node_modules"}
IGNORE_FILES = {".env", "resume_cache.json", "resume_cache.txt", "LICENSE", "jobhunt_task.xml"}
IGNORE_EXTENSIONS = {".pdf", ".db", ".xlsx", ".log", ".csv"}
SKIP_PATHS = {"scripts/security_scan.py", "scripts\\security_scan.py"}


def scan_file(path: str) -> list[tuple[str, str]]:
    hits = []
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            content = f.read()
    except OSError:
        return hits
    for pattern, label in PATTERNS:
        if re.search(pattern, content, re.I):
            hits.append((label, path))
    return hits


def main():
    all_hits = []
    for root, dirs, files in os.walk(BASE):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for fname in files:
            if fname in IGNORE_FILES:
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext in IGNORE_EXTENSIONS:
                continue
            path = os.path.join(root, fname)
            rel = os.path.relpath(path, BASE)
            if rel.replace("\\", "/") in SKIP_PATHS:
                continue
            if rel.startswith("outputs" + os.sep) or rel.startswith("logs" + os.sep):
                continue
            all_hits.extend(scan_file(path))

    if all_hits:
        print("SECRET SCAN FAILED — do not commit:")
        for label, path in all_hits:
            print(f"  [{label}] {os.path.relpath(path, BASE)}")
        sys.exit(1)

    print("SECRET SCAN PASSED — no secrets detected in tracked source files.")
    sys.exit(0)


if __name__ == "__main__":
    main()
