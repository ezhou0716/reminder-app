import json
import os
import time
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from config import CALNET_ID, CALNET_PASSPHRASE, LOOKAHEAD_HOURS

COOKIES_PATH = os.path.join(os.path.dirname(__file__), "gradescope_cookies.json")
GRADESCOPE_URL = "https://www.gradescope.com"
PACIFIC = ZoneInfo("America/Los_Angeles")


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
    resp = session.get(f"{GRADESCOPE_URL}/account", allow_redirects=False)
    return resp.status_code == 200


def _login_via_calnet():
    """Open Edge browser for CalNet SSO login, return cookies after auth."""
    options = webdriver.EdgeOptions()
    driver = webdriver.Edge(options=options)

    try:
        # Go to Gradescope's SAML school-selection page
        driver.get(f"{GRADESCOPE_URL}/saml")

        # Wait for the page to load, then search for and select "CalNet ID"
        print("  [Gradescope] Selecting CalNet ID on SAML page...", flush=True)
        WebDriverWait(driver, 15).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='text'], input[placeholder]"))
        )
        search_input = driver.find_element(By.CSS_SELECTOR, "input[type='text'], input[placeholder]")
        search_input.send_keys("CalNet")
        time.sleep(1.5)

        # Click the "CalNet ID" result from the dropdown
        calnet_btn = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, "div.samlProvider--name"))
        )
        calnet_btn.click()

        # Wait for CalNet login page to load (may take a moment for redirect)
        print("  [Gradescope] Waiting for CalNet login page...", flush=True)
        WebDriverWait(driver, 30).until(EC.url_contains("auth.berkeley.edu"))
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "username"))
        )

        # Auto-fill credentials
        driver.find_element(By.ID, "username").send_keys(CALNET_ID)
        driver.find_element(By.ID, "password").send_keys(CALNET_PASSPHRASE)
        driver.find_element(By.ID, "submitBtn").click()

        # Wait for redirect back to Gradescope — user may need to handle Duo 2FA
        print("  [Gradescope] Waiting for CalNet auth (complete Duo if prompted)...", flush=True)
        WebDriverWait(driver, 180).until(
            EC.url_contains("gradescope.com")
        )

        time.sleep(2)
        cookies = driver.get_cookies()
        _save_cookies(cookies)
        print("  [Gradescope] Login successful, cookies saved.", flush=True)
        return cookies
    finally:
        driver.quit()


def _get_session():
    """Get an authenticated requests session for Gradescope."""
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


def _parse_date(text):
    """Parse Gradescope's displayed date into a UTC datetime."""
    text = text.replace("\n", " ").strip()
    for prefix in ("Due ", "Due: ", "due ", "Due Date: "):
        if text.startswith(prefix):
            text = text[len(prefix):]

    formats = [
        "%b %d, %Y %I:%M %p",
        "%b %d, %Y at %I:%M %p",
        "%B %d, %Y %I:%M %p",
        "%B %d, %Y at %I:%M %p",
        "%b %d at %I:%M %p",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(text.strip(), fmt)
            # If year is 1900 (missing from format), assume current year
            if dt.year == 1900:
                dt = dt.replace(year=datetime.now().year)
            return dt.replace(tzinfo=PACIFIC).astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def cookies_valid() -> bool:
    """Check whether saved Gradescope cookies are still valid."""
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
        print(f"  [Gradescope] Login failed: {e}", flush=True)
        return False


def get_upcoming_assignments() -> list[dict]:
    """Fetch assignments due within the lookahead window from Gradescope."""
    session = _get_session()
    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(hours=LOOKAHEAD_HOURS)
    assignments = []

    # Fetch account page to get course list (not the home page)
    resp = session.get(f"{GRADESCOPE_URL}/account")
    soup = BeautifulSoup(resp.text, "html.parser")

    # Courses live inside div.courseList as <a> tags with /courses/{id} hrefs
    course_links = soup.select("div.courseList a[href*='/courses/']")
    if not course_links:
        # Broader fallback
        course_links = soup.select("a[href*='/courses/']")

    seen_courses = set()
    for link in course_links:
        href = link.get("href", "")
        if "/courses/" not in href:
            continue
        parts = href.strip("/").split("/")
        try:
            idx = parts.index("courses")
            course_id = parts[idx + 1]
        except (ValueError, IndexError):
            continue
        if course_id in seen_courses:
            continue
        seen_courses.add(course_id)

        # Extract course name from courseBox child elements
        short = link.select_one("h3.courseBox--shortname")
        full = link.select_one("div.courseBox--name")
        course_name = (
            (short.get_text(strip=True) if short else None)
            or (full.get_text(strip=True) if full else None)
            or link.get_text(strip=True)
            or f"Course {course_id}"
        )

        try:
            # Student view: /courses/{id} shows the assignment table
            resp = session.get(f"{GRADESCOPE_URL}/courses/{course_id}")
            asoup = BeautifulSoup(resp.text, "html.parser")

            # Assignment rows use role="row" in the student view table
            rows = asoup.select("tr[role='row']")
            if not rows:
                rows = asoup.select("tr")

            for row in rows:
                cells = row.select("td")
                if not cells:
                    continue

                # Assignment name lives in the row's <th>, not <td>
                th = row.select_one("th")
                name = th.get_text(strip=True) if th else cells[0].get_text(strip=True)

                # Assignment ID: from a link or a submit button
                assign_id = None
                assign_link = row.select_one("a[href*='/assignments/']")
                if assign_link:
                    assign_id = assign_link.get("href", "").strip("/").split("/")[-1]
                else:
                    submit_btn = row.select_one("button.js-submitAssignment")
                    if submit_btn:
                        assign_id = submit_btn.get("data-assignment-id")
                    else:
                        continue

                if not assign_id:
                    continue

                # Due date: prefer datetime attribute on submissionTimeChart--dueDate
                due_at = None
                due_el = row.select_one(".submissionTimeChart--dueDate")
                if due_el and due_el.get("datetime"):
                    try:
                        due_at = datetime.fromisoformat(
                            due_el["datetime"].replace("Z", "+00:00")
                        )
                    except ValueError:
                        pass

                # Fallback: parse displayed text in cells
                if not due_at:
                    for cell in cells:
                        parsed = _parse_date(cell.get_text(strip=True))
                        if parsed:
                            due_at = parsed
                            break

                if not due_at:
                    continue

                if now < due_at <= cutoff:
                    # Check submission status
                    row_text = row.get_text()
                    submitted = (
                        "Submitted" in row_text
                        or row.select_one(".submissionStatus--submitted") is not None
                        or row.select_one(".workflowCheck--complete") is not None
                    )

                    assignments.append({
                        "id": f"gs_{course_id}_{assign_id}",
                        "name": name,
                        "course_name": course_name,
                        "due_at": due_at,
                        "url": f"{GRADESCOPE_URL}/courses/{course_id}/assignments/{assign_id}",
                        "source": "gradescope",
                        "submitted": submitted,
                    })
        except Exception as e:
            print(f"  [Gradescope] Error fetching assignments for {course_name}: {e}", flush=True)

    return assignments
