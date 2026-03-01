import json
import os
import time
from datetime import datetime, timezone, timedelta

import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from config import CANVAS_API_URL, CALNET_ID, CALNET_PASSPHRASE, LOOKAHEAD_HOURS

COOKIES_PATH = os.path.join(os.path.dirname(__file__), "bcourses_cookies.json")


def _save_cookies(cookies):
    with open(COOKIES_PATH, "w") as f:
        json.dump(cookies, f)


def _load_cookies():
    if os.path.exists(COOKIES_PATH):
        with open(COOKIES_PATH) as f:
            return json.load(f)
    return None


def _apply_cookies(session, cookies):
    for cookie in cookies:
        session.cookies.set(cookie["name"], cookie["value"], domain=cookie.get("domain", ""))


def _cookies_valid(cookies):
    """Check if saved cookies still give us an authenticated session."""
    session = requests.Session()
    _apply_cookies(session, cookies)
    resp = session.get(f"{CANVAS_API_URL}/api/v1/users/self", allow_redirects=False)
    return resp.status_code == 200


def _login_via_calnet():
    """Open Edge browser for CalNet CAS login, return cookies after auth."""
    options = webdriver.EdgeOptions()
    driver = webdriver.Edge(options=options)

    try:
        # bCourses uses CAS auth — /login/cas redirects to CalNet
        driver.get(f"{CANVAS_API_URL}/login/cas")

        # Wait for CalNet login page (CAS redirect)
        print("  [Canvas] Waiting for CalNet login page...", flush=True)
        WebDriverWait(driver, 30).until(EC.url_contains("auth.berkeley.edu"))
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "username"))
        )

        # Auto-fill credentials
        driver.find_element(By.ID, "username").send_keys(CALNET_ID)
        driver.find_element(By.ID, "password").send_keys(CALNET_PASSPHRASE)

        # Submit — try known button IDs, fall back to form submit
        try:
            driver.find_element(By.ID, "submitBtn").click()
        except Exception:
            driver.find_element(By.CSS_SELECTOR, "#fm1 input[type='submit'], #fm1 button[type='submit']").click()

        # Wait for redirect back to bCourses — user may need to handle Duo 2FA
        print("  [Canvas] Waiting for CalNet auth (complete Duo if prompted)...", flush=True)
        WebDriverWait(driver, 180).until(
            EC.url_contains("bcourses.berkeley.edu")
        )

        time.sleep(2)
        cookies = driver.get_cookies()
        _save_cookies(cookies)
        print("  [Canvas] Login successful, cookies saved.", flush=True)
        return cookies
    finally:
        driver.quit()


def _get_session():
    """Get an authenticated requests session for bCourses."""
    cookies = _load_cookies()
    if cookies and _cookies_valid(cookies):
        session = requests.Session()
        _apply_cookies(session, cookies)
        return session

    # Cookies missing or expired — need fresh login
    cookies = _login_via_calnet()
    session = requests.Session()
    _apply_cookies(session, cookies)
    return session


def cookies_valid() -> bool:
    """Check whether saved bCourses cookies are still valid."""
    cookies = _load_cookies()
    if not cookies:
        return False
    return _cookies_valid(cookies)


def login_via_calnet() -> bool:
    """Run the CalNet/Duo login flow and return True on success."""
    try:
        cookies = _login_via_calnet()
        return cookies is not None and len(cookies) > 0
    except Exception as e:
        print(f"  [Canvas] Login failed: {e}", flush=True)
        return False


def get_upcoming_assignments() -> list[dict]:
    """Fetch assignments due within the lookahead window from bCourses."""
    session = _get_session()
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(hours=LOOKAHEAD_HOURS)
    assignments = []

    # Fetch active courses
    resp = session.get(
        f"{CANVAS_API_URL}/api/v1/courses",
        params={"enrollment_state": "active", "per_page": 100},
    )
    if resp.status_code != 200:
        print(f"  [Canvas] Failed to fetch courses: {resp.status_code}", flush=True)
        return assignments

    courses = resp.json()
    for course in courses:
        course_id = course["id"]
        course_name = course.get("name", "Unknown Course")

        try:
            resp = session.get(
                f"{CANVAS_API_URL}/api/v1/courses/{course_id}/assignments",
                params={
                    "bucket": "upcoming",
                    "order_by": "due_at",
                    "include[]": "submission",
                    "per_page": 100,
                },
            )
            if resp.status_code != 200:
                continue

            for assignment in resp.json():
                due_at_str = assignment.get("due_at")
                if not due_at_str:
                    continue
                due_at = datetime.fromisoformat(due_at_str.replace("Z", "+00:00"))
                if now < due_at <= cutoff:
                    # Check submission status
                    submission = assignment.get("submission", {}) or {}
                    workflow = submission.get("workflow_state", "")
                    submitted = workflow in ("submitted", "graded")

                    assignments.append({
                        "id": str(assignment["id"]),
                        "name": assignment["name"],
                        "course_name": course_name,
                        "due_at": due_at,
                        "url": assignment.get("html_url", ""),
                        "source": "canvas",
                        "submitted": submitted,
                    })
        except Exception as e:
            print(f"  [Canvas] Error fetching assignments for {course_name}: {e}", flush=True)

    return assignments
