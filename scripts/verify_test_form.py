"""Verify test form autofill, submit button, and confirmation message."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import utils.env_loader  # noqa: F401

from utils.apply_agent import (
    _field_context,
    _match_field,
    _safe_fill,
    _show_review_banner,
    _try_upload_resume,
    is_pause_field,
    launch_application,
)
from utils.apply_profile import get_apply_profile

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEST_FORM = os.path.join(BASE, "test_data", "apply_test_form.html")
CONFIRM_TEXT = "Test submit clicked. For real applications, user must manually review and submit."
BANNER_TEXT = "REVIEW AND SUBMIT — Alligator Apply paused before sensitive fields"


def main():
    url = "file:///" + TEST_FORM.replace("\\", "/")
    profile = get_apply_profile()

    result = launch_application(
        apply_url=url,
        profile=profile,
        cover_letter="Test cover letter from Alligator Apply verification.",
        headless=True,
        wait_seconds=3,
    )

    from playwright.sync_api import sync_playwright

    checks = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url, wait_until="domcontentloaded")

        for i in range(page.locator("input, textarea").count()):
            el = page.locator("input, textarea").nth(i)
            try:
                if not el.is_visible():
                    continue
            except Exception:
                continue
            ctx = _field_context(el)
            if is_pause_field(ctx):
                continue
            field = _match_field(ctx)
            if field == "full_name":
                _safe_fill(el, profile.get("full_name", ""))
            elif field == "email":
                _safe_fill(el, profile.get("email", ""))
            elif field == "phone":
                _safe_fill(el, profile.get("phone", ""))
            elif field == "cover_letter":
                _safe_fill(el, "Test cover letter.")
        _try_upload_resume(page, profile.get("resume_path", ""))
        _show_review_banner(page)

        checks["banner_visible"] = BANNER_TEXT in (page.locator("#alligator-apply-banner").inner_text() or "")
        checks["name_filled"] = bool(page.input_value("#full_name"))
        checks["email_filled"] = bool(page.input_value("#email"))
        checks["submit_visible"] = page.locator("#submit-test-btn").is_visible()
        checks["submit_text"] = page.locator("#submit-test-btn").inner_text().strip() == "Submit Test Application"

        page.locator("#submit-test-btn").click()
        page.wait_for_timeout(300)
        checks["confirm_shown"] = CONFIRM_TEXT in page.locator("#test-submit-msg").inner_text()

        browser.close()

    print("=== Test Form Verification ===")
    print(f"Agent autofill: {result.get('filled', [])}")
    print(f"Agent paused_at: {result.get('paused_at', [])}")
    for k, v in checks.items():
        print(f"  {k}: {'PASS' if v else 'FAIL'}")
    all_ok = all(checks.values()) and len(result.get("filled", [])) >= 3
    print(f"\nOverall: {'PASS' if all_ok else 'FAIL'}")
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
