"""CLI launcher for Playwright Apply Agent."""
import argparse
import json
import os
import sys
import traceback

import utils.env_loader  # noqa: F401

from utils.apply_agent import launch_application
from utils.apply_db import fetch_job
from utils.apply_logging import apply_log, record_apply_error
from utils.apply_profile import get_apply_profile, profile_complete_for_launch

BASE = os.path.abspath(os.path.dirname(__file__))
SESSIONS_DIR = os.path.join(BASE, "outputs", "apply_sessions")
TEST_FORM = os.path.join(BASE, "test_data", "apply_test_form.html")


def run_test(profile: dict, headless: bool, wait_seconds: int = 600) -> dict:
    if not os.path.exists(TEST_FORM):
        raise FileNotFoundError(f"Test form missing: {TEST_FORM}")
    url = TEST_FORM.replace("\\", "/")
    if not url.startswith("/") and ":" in url:
        url = "file:///" + url
    else:
        url = "file://" + url
    apply_log.info("Test mode: opening %s", url)
    return launch_application(
        apply_url=url,
        profile=profile,
        cover_letter="This is a test cover letter from Alligator Apply test mode.",
        headless=headless,
        wait_seconds=wait_seconds,
    )


def main():
    parser = argparse.ArgumentParser(description="Launch Playwright application assistant")
    parser.add_argument("--job-id", default=None, help="Job ID from jobs.db")
    parser.add_argument("--test", action="store_true", help="Open local test HTML form")
    parser.add_argument("--headless", action="store_true", default=False)
    parser.add_argument("--wait", type=int, default=600, help="Seconds to keep browser open")
    args = parser.parse_args()

    if not args.test and not args.job_id:
        print("Provide --job-id or --test")
        sys.exit(1)

    profile = get_apply_profile()
    ok, missing = profile_complete_for_launch(profile)
    if not ok:
        msg = f"Missing for launch: {', '.join(missing)}"
        print(msg)
        record_apply_error(msg)
        sys.exit(1)

    apply_log.info("Profile loaded: name=%s email=%s resume=%s",
                   profile.get("full_name"), profile.get("email"), profile.get("resume_path"))

    cover = ""
    job_id = args.job_id or "test"
    company = ""
    title = ""

    try:
        if args.test:
            result = run_test(profile, args.headless, args.wait)
            job_id = "test"
            title = "Test Form"
            company = "Alligator Apply"
        else:
            job = fetch_job(args.job_id)
            if not job:
                msg = f"Job not found: {args.job_id}"
                print(msg)
                record_apply_error(msg)
                sys.exit(1)

            url = (job.get("url") or "").strip()
            if not url.startswith("http"):
                msg = f"Invalid apply_url for job {args.job_id}: {url!r}"
                print(msg)
                record_apply_error(msg)
                sys.exit(1)

            company = job.get("company", "")
            title = job.get("title", "")

            packet = {}
            if job.get("application_packet"):
                try:
                    packet = json.loads(job["application_packet"])
                except Exception:
                    packet = {}
            cover = packet.get("cover_letter", "")

            apply_log.info("Launching apply URL: %s", url)
            result = launch_application(
                apply_url=url,
                profile=profile,
                cover_letter=cover,
                headless=args.headless,
                wait_seconds=args.wait,
            )

        result["job_id"] = job_id
        result["company"] = company
        result["title"] = title

        os.makedirs(SESSIONS_DIR, exist_ok=True)
        out = os.path.join(SESSIONS_DIR, f"{job_id}.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"Session saved: {out}")
        print(json.dumps(result, indent=2))

        if result.get("status") == "error":
            record_apply_error(result.get("message", "Unknown apply error"))
            sys.exit(1)

    except Exception as e:
        msg = f"Launch failed: {e}\n{traceback.format_exc()[-800:]}"
        apply_log.error(msg)
        record_apply_error(str(e))
        print(msg)
        sys.exit(1)


if __name__ == "__main__":
    main()
