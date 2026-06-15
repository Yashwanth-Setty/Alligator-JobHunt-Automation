"""
Playwright Apply Agent — autofill basic fields, pause before sensitive sections.
Never auto-submits. User must review and submit manually.
"""
import logging
import os
import re
import time
from datetime import datetime

from utils.apply_logging import apply_log

log = apply_log

PAUSE_PATTERNS = {
    "visa": re.compile(
        r"visa|sponsorship|work\s*authorization|authorized\s*to\s*work|"
        r"legally\s*authorized|immigration|opt|cpt|h-?1b|i-?9",
        re.I,
    ),
    "salary": re.compile(
        r"salary|compensation|pay\s*range|expected\s*pay|desired\s*pay|"
        r"hourly\s*rate|annual\s*salary",
        re.I,
    ),
    "eeo": re.compile(
        r"\beeo\b|equal\s*opportunity|gender|race|ethnicity|veteran|"
        r"disability|lgbt|demographic|ofccp",
        re.I,
    ),
    "captcha": re.compile(
        r"captcha|recaptcha|hcaptcha|i'?m\s*not\s*a\s*robot|security\s*check",
        re.I,
    ),
}

FIELD_HINTS = {
    "full_name": re.compile(r"full\s*name|^name$|first\s*name|fname", re.I),
    "first_name": re.compile(r"first\s*name|fname|given\s*name", re.I),
    "last_name": re.compile(r"last\s*name|lname|surname|family\s*name", re.I),
    "email": re.compile(r"email|e-mail", re.I),
    "phone": re.compile(r"phone|mobile|tel", re.I),
    "address": re.compile(r"address|street", re.I),
    "city": re.compile(r"city|town", re.I),
    "state": re.compile(r"\bstate\b|province", re.I),
    "zip": re.compile(r"zip|postal", re.I),
    "linkedin": re.compile(r"linkedin", re.I),
    "github": re.compile(r"github|git\s*hub", re.I),
    "cover_letter": re.compile(r"cover\s*letter|why\s*interested|additional\s*info", re.I),
}


def _field_context(el) -> str:
    parts = []
    try:
        parts.append(el.get_attribute("name") or "")
        parts.append(el.get_attribute("id") or "")
        parts.append(el.get_attribute("placeholder") or "")
        parts.append(el.get_attribute("aria-label") or "")
    except Exception:
        pass
    return " ".join(parts)


def is_pause_field(context: str) -> str | None:
    for category, pattern in PAUSE_PATTERNS.items():
        if pattern.search(context):
            return category
    return None


def _match_field(context: str) -> str | None:
    for field, pattern in FIELD_HINTS.items():
        if pattern.search(context):
            return field
    return None


def _safe_fill(el, value: str) -> bool:
    if not value:
        return False
    try:
        tag = (el.evaluate("e => e.tagName") or "").lower()
        if tag in ("input", "textarea"):
            input_type = (el.get_attribute("type") or "text").lower()
            if input_type in ("file", "hidden", "submit", "button", "checkbox", "radio"):
                return False
            el.fill(value)
            return True
    except Exception as e:
        log.debug("Fill failed: %s", e)
    return False


def _try_upload_resume(page, resume_path: str) -> bool:
    if not resume_path or not os.path.exists(resume_path):
        return False
    try:
        inputs = page.locator('input[type="file"]')
        count = inputs.count()
        for i in range(min(count, 3)):
            inp = inputs.nth(i)
            ctx = _field_context(inp)
            if is_pause_field(ctx):
                continue
            try:
                inp.set_input_files(resume_path)
                return True
            except Exception:
                continue
    except Exception as e:
        log.debug("Resume upload failed: %s", e)
    return False


def _show_review_banner(page) -> None:
    script = """
    () => {
      const id = 'alligator-apply-banner';
      if (document.getElementById(id)) return;
      const d = document.createElement('div');
      d.id = id;
      d.innerText = 'REVIEW AND SUBMIT — Alligator Apply paused before sensitive fields. You must submit manually.';
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999999;background:#b45309;color:#fff;padding:14px 18px;font:600 16px system-ui;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3)';
      document.body.appendChild(d);
    }
    """
    try:
        page.evaluate(script)
    except Exception:
        pass


def launch_application(
    apply_url: str,
    profile: dict,
    cover_letter: str = "",
    headless: bool = False,
    wait_seconds: int = 600,
) -> dict:
    """
    Open apply page, autofill safe fields, pause before sensitive sections.
    Blocks until browser closes or timeout. Never clicks submit.
    """
    from playwright.sync_api import sync_playwright

    result = {
        "status": "launched",
        "url": apply_url,
        "filled": [],
        "paused_at": [],
        "resume_uploaded": False,
        "launched_at": datetime.now().isoformat(),
        "message": "Review and Submit — complete visa/salary/EEO/CAPTCHA manually.",
    }

    if not apply_url:
        result["status"] = "error"
        result["message"] = "Missing apply URL"
        return result

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless, slow_mo=80)
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(15000)

        try:
            page.goto(apply_url, wait_until="domcontentloaded", timeout=45000)
            time.sleep(2)

            filled_fields = set()
            pause_hits = set()

            inputs = page.locator("input, textarea, select")
            count = inputs.count()
            for i in range(min(count, 120)):
                el = inputs.nth(i)
                try:
                    if not el.is_visible():
                        continue
                except Exception:
                    continue

                ctx = _field_context(el)
                pause = is_pause_field(ctx)
                if pause:
                    pause_hits.add(pause)
                    continue

                field = _match_field(ctx)
                if field == "full_name" and "full_name" not in filled_fields:
                    if _safe_fill(el, profile.get("full_name", "")):
                        filled_fields.add("full_name")
                elif field == "first_name" and "first_name" not in filled_fields:
                    parts = (profile.get("full_name", "") or "").split(None, 1)
                    if _safe_fill(el, parts[0] if parts else ""):
                        filled_fields.add("first_name")
                elif field == "last_name" and "last_name" not in filled_fields:
                    parts = (profile.get("full_name", "") or "").split(None, 1)
                    if _safe_fill(el, parts[1] if len(parts) > 1 else ""):
                        filled_fields.add("last_name")
                elif field == "email" and "email" not in filled_fields:
                    if _safe_fill(el, profile.get("email", "")):
                        filled_fields.add("email")
                elif field == "phone" and "phone" not in filled_fields:
                    if _safe_fill(el, profile.get("phone", "")):
                        filled_fields.add("phone")
                elif field == "address" and "address" not in filled_fields:
                    if _safe_fill(el, profile.get("address", "")):
                        filled_fields.add("address")
                elif field == "city" and "city" not in filled_fields:
                    if _safe_fill(el, profile.get("city", "")):
                        filled_fields.add("city")
                elif field == "state" and "state" not in filled_fields:
                    if _safe_fill(el, profile.get("state", "")):
                        filled_fields.add("state")
                elif field == "zip" and "zip" not in filled_fields:
                    if _safe_fill(el, profile.get("zip", "")):
                        filled_fields.add("zip")
                elif field == "linkedin" and "linkedin" not in filled_fields:
                    if _safe_fill(el, profile.get("linkedin", "")):
                        filled_fields.add("linkedin")
                elif field == "github" and "github" not in filled_fields:
                    if _safe_fill(el, profile.get("github", "")):
                        filled_fields.add("github")
                elif field == "cover_letter" and cover_letter and "cover_letter" not in filled_fields:
                    if _safe_fill(el, cover_letter[:4000]):
                        filled_fields.add("cover_letter")

            if _try_upload_resume(page, profile.get("resume_path", "")):
                result["resume_uploaded"] = True
                filled_fields.add("resume")

            result["filled"] = sorted(filled_fields)
            result["paused_at"] = sorted(pause_hits)
            _show_review_banner(page)

            apply_log.info("Autofill complete: %s paused_at=%s", sorted(filled_fields), sorted(pause_hits))

            print("\n" + "=" * 60)
            print("REVIEW AND SUBMIT")
            print("Alligator Apply filled basic fields only.")
            print("Paused before:", ", ".join(result["paused_at"]) or "sensitive sections if present")
            print("Visa / salary / EEO / CAPTCHA must be completed by you.")
            print("Do NOT rely on auto-submit. Submit only after your review.")
            print("Close the browser when done.")
            print("=" * 60 + "\n")

            result["status"] = "awaiting_review"
            deadline = time.time() + wait_seconds
            while time.time() < deadline:
                try:
                    if not browser.is_connected():
                        break
                    page.wait_for_timeout(1000)
                except Exception:
                    break

            result["status"] = "review_complete"

        except Exception as e:
            log.error("Apply agent error: %s", e, exc_info=True)
            result["status"] = "error"
            result["message"] = str(e)[:300]
        finally:
            try:
                browser.close()
            except Exception:
                pass

    return result
