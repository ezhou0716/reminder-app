import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "reminders.db")


def _get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS sent_reminders (
            assignment_id TEXT,
            source TEXT,
            threshold TEXT,
            sent_at TIMESTAMP,
            PRIMARY KEY (assignment_id, source, threshold)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS completed_assignments (
            assignment_id TEXT,
            source TEXT,
            PRIMARY KEY (assignment_id, source)
        )
    """)
    conn.commit()
    return conn


def was_reminder_sent(assignment_id: str, source: str, threshold: str) -> bool:
    conn = _get_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM sent_reminders WHERE assignment_id = ? AND source = ? AND threshold = ?",
            (assignment_id, source, threshold),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def is_completed(assignment_id, source: str) -> bool:
    conn = _get_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM completed_assignments WHERE assignment_id = ? AND source = ?",
            (str(assignment_id), source),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def mark_completed(assignment_id, source: str):
    conn = _get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO completed_assignments (assignment_id, source) VALUES (?, ?)",
            (str(assignment_id), source),
        )
        conn.commit()
    finally:
        conn.close()


def unmark_completed(assignment_id, source: str):
    conn = _get_connection()
    try:
        conn.execute(
            "DELETE FROM completed_assignments WHERE assignment_id = ? AND source = ?",
            (str(assignment_id), source),
        )
        conn.commit()
    finally:
        conn.close()


def mark_reminder_sent(assignment_id: str, source: str, threshold: str):
    conn = _get_connection()
    try:
        conn.execute(
            "INSERT OR IGNORE INTO sent_reminders (assignment_id, source, threshold, sent_at) VALUES (?, ?, ?, ?)",
            (assignment_id, source, threshold, datetime.now().isoformat()),
        )
        conn.commit()
    finally:
        conn.close()
