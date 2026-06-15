import os, sys, logging
sys.path.insert(0, os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..")
))
import utils.env_loader  # noqa: F401

log = logging.getLogger("alligator_apply")

try:
    from filters import ML_KEYWORDS, TITLE_BLOCK
except Exception:
    ML_KEYWORDS = ["machine learning", "ml engineer", "ai engineer", "llm"]
    TITLE_BLOCK = []

try:
    from company_filter import is_company_ok
except Exception:
    is_company_ok = lambda j: True


class BaseAgent:
    def __init__(self, name):
        self.name = name

    def scrape(self):
        return []

    def run(self):
        try:
            import main as _m
            from utils.liveness   import check_liveness
            from utils.archetype  import detect_archetype
            from utils.legitimacy import score_legitimacy

            db    = _m.get_db()
            stats = _m.RunStats()
            jobs  = self.scrape()
            log.info(f"{self.name} agent: {len(jobs)} raw jobs")

            from utils.us_filter import partition_us_jobs
            jobs, rejected = partition_us_jobs(jobs)
            if rejected:
                log.info(f"{self.name} agent: {rejected} non-US jobs rejected")

            for job in jobs[:50]:
                if not _m.validate_job(job):
                    continue

                title = job.get("title", "").lower()
                desc  = job.get("description", "").lower()
                text  = title + " " + desc
                if any(b in title for b in TITLE_BLOCK):
                    continue
                if not any(kw in text for kw in ML_KEYWORDS):
                    continue

                if not is_company_ok(job):
                    stats.skipped += 1
                    continue

                jid = _m.job_id(job)
                if not _m.is_new(jid, db):
                    stats.skipped += 1
                    continue

                if not _m.visa_ok(job):
                    stats.visa_block += 1
                    _m.save(job, 0, db)
                    continue

                liveness = check_liveness(job.get("url", ""))
                if liveness == "expired":
                    stats.expired += 1
                    stats.skipped += 1
                    continue

                job["archetype"]  = detect_archetype(job)
                job["legitimacy"] = score_legitimacy(job)

                result = _m.score(job, stats)
                if result is None:
                    continue

                _m.save(job, result["pct"], db)

                if hasattr(_m, "inject_career_ops"):
                    _m.inject_career_ops(job, result)

                if result["pct"] >= 50:
                    stats.excel_rows += 1

                if result["tier"] == "GREEN":
                    stats.green += 1
                    from utils.notifications import notify_match
                    notify_match(job, result, visa_compatible=True)
                    if hasattr(_m, "log_alert"):
                        _m.log_alert(job, result)
                elif result["tier"] == "AMBER":
                    stats.amber += 1
                else:
                    stats.red += 1

            log.info(f"{self.name} agent done: {stats.summary()}")
            db.close()
        except Exception as e:
            log.error(f"{self.name} agent run() error: {e}", exc_info=True)
