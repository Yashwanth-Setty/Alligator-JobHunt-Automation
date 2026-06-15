"""Compare job scores: skills-fallback (stored) vs real resume PDF."""
import sqlite3
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import utils.env_loader  # noqa: F401

from main import score, RunStats

DB = os.path.join(os.path.dirname(__file__), "..", "jobs.db")
conn = sqlite3.connect(DB)
rows = conn.execute(
    "SELECT id, title, company, url, source, score FROM jobs "
    "WHERE score >= 50 ORDER BY score DESC LIMIT 10"
).fetchall()
conn.close()

stats = RunStats()
results = []
for r in rows:
    job = {"title": r[1], "company": r[2], "url": r[3], "source": r[4], "description": ""}
    old = r[5]
    out = score(job, stats)
    new = out["pct"] if out else None
    results.append({"title": r[1][:50], "company": r[2], "before": old, "after": new})

print("=== SCORING COMPARISON (stored vs real resume PDF) ===")
print(f"Jobs re-scored: {len(results)} | Failures: {stats.score_fail}")
for x in results:
    if x["after"] is not None:
        delta = x["after"] - x["before"]
        print(f"  {x['before']}% -> {x['after']}% ({delta:+d}) | {x['title']} @ {x['company']}")
    else:
        print(f"  {x['before']}% -> FAIL | {x['title']} @ {x['company']}")

green_b = sum(1 for x in results if x["before"] >= 75)
amber_b = sum(1 for x in results if 50 <= x["before"] < 75)
green_a = sum(1 for x in results if x["after"] and x["after"] >= 75)
amber_a = sum(1 for x in results if x["after"] and 50 <= x["after"] < 75)
print(f"Before (top 10 stored): GREEN={green_b} AMBER={amber_b}")
print(f"After  (real resume):   GREEN={green_a} AMBER={amber_a}")
