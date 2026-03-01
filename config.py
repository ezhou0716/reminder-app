import os
from dotenv import load_dotenv

load_dotenv()

CANVAS_API_URL = os.getenv("CANVAS_API_URL", "https://bcourses.berkeley.edu")

GRADESCOPE_EMAIL = os.getenv("GRADESCOPE_EMAIL", "")
GRADESCOPE_PASSWORD = os.getenv("GRADESCOPE_PASSWORD", "")

# CalNet ID is the part before @ in the Berkeley email
CALNET_ID = GRADESCOPE_EMAIL.split("@")[0] if GRADESCOPE_EMAIL else ""
CALNET_PASSPHRASE = GRADESCOPE_PASSWORD

# Reminder thresholds in hours
REMINDER_THRESHOLDS = [24, 3]

# How often to check for upcoming assignments (minutes)
CHECK_INTERVAL_MINUTES = 30

# How far ahead to look for assignments (hours)
LOOKAHEAD_HOURS = 168
