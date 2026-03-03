import subprocess
import sys
from win11toast import toast


def send_reminder(assignment: dict, hours_remaining: float, threshold: str):
    """Send a Windows toast notification for an upcoming assignment."""
    course = assignment["course_name"]
    name = assignment["name"]
    url = assignment.get("url", "")

    if threshold == "3h":
        title = f"URGENT: Due in ~{int(hours_remaining)}h!"
    else:
        title = f"Due in ~{int(hours_remaining)} hours"
    body = f"{course}\n{name}"

    try:
        # Launch toast in a separate process so it doesn't block the scheduler.
        # The subprocess opens the URL on click via a small inline script.
        subprocess.Popen(
            [
                sys.executable, "-c",
                "import sys; from win11toast import toast; "
                "toast(sys.argv[1], sys.argv[2], on_click=sys.argv[3] or None)",
                title, body, url,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as e:
        print(f"  [Notifier] Failed to send notification: {e}", flush=True)
