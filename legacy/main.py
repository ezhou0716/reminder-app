import sys
import time
from datetime import datetime, timezone
from functools import partial

import schedule

# Unbuffered print so output appears immediately in all terminals
print = partial(print, flush=True)

from config import (
    GRADESCOPE_EMAIL,
    GRADESCOPE_PASSWORD,
    REMINDER_THRESHOLDS,
    CHECK_INTERVAL_MINUTES,
)
from canvas_client import get_upcoming_assignments as get_canvas_assignments
from gradescope_client import get_upcoming_assignments as get_gradescope_assignments
from db import was_reminder_sent, mark_reminder_sent, is_completed
from notifier import send_reminder


def validate_config():
    """Exit early if credentials are missing."""
    missing = []
    if not GRADESCOPE_EMAIL or GRADESCOPE_EMAIL == "your_email@berkeley.edu":
        missing.append("GRADESCOPE_EMAIL")
    if not GRADESCOPE_PASSWORD or GRADESCOPE_PASSWORD == "your_password_here":
        missing.append("GRADESCOPE_PASSWORD")
    if missing:
        print("ERROR: Missing credentials in .env file:")
        for var in missing:
            print(f"  - {var}")
        print("\nEdit .env and fill in your credentials, then re-run.")
        sys.exit(1)


def check_and_notify():
    """Fetch assignments from all sources and send reminders as needed."""
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Checking for upcoming assignments...")
    now = datetime.now(timezone.utc)
    all_assignments = []

    # Fetch from Canvas
    try:
        canvas = get_canvas_assignments()
        print(f"  Found {len(canvas)} upcoming Canvas assignment(s)")
        all_assignments.extend(canvas)
    except Exception as e:
        print(f"  [Canvas] Error: {e}")

    # Fetch from Gradescope
    try:
        gs = get_gradescope_assignments()
        print(f"  Found {len(gs)} upcoming Gradescope assignment(s)")
        all_assignments.extend(gs)
    except Exception as e:
        print(f"  [Gradescope] Error: {e}")

    # Check each assignment against thresholds
    notified = 0
    for assignment in all_assignments:
        if assignment.get("submitted") or is_completed(assignment["id"], assignment["source"]):
            continue
        hours_left = (assignment["due_at"] - now).total_seconds() / 3600
        for threshold in sorted(REMINDER_THRESHOLDS):
            threshold_key = f"{threshold}h"
            if hours_left <= threshold:
                if not was_reminder_sent(assignment["id"], assignment["source"], threshold_key):
                    send_reminder(assignment, hours_left, threshold_key)
                    mark_reminder_sent(assignment["id"], assignment["source"], threshold_key)
                    print(f"  Sent {threshold_key} reminder: {assignment['course_name']} - {assignment['name']}")
                    notified += 1

    if notified == 0:
        print("  No new reminders to send.")

    return all_assignments


def main():
    validate_config()

    print("=" * 50)
    print("  Berkeley Assignment Reminder")
    print("=" * 50)
    print(f"Checking every {CHECK_INTERVAL_MINUTES} minutes")
    print(f"Reminder thresholds: {', '.join(str(t) + 'h' for t in REMINDER_THRESHOLDS)}")
    print("Press Ctrl+C to stop.\n")

    # Run immediately on startup
    check_and_notify()

    # Schedule periodic checks
    schedule.every(CHECK_INTERVAL_MINUTES).minutes.do(check_and_notify)

    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
