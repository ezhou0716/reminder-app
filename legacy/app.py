"""Tkinter desktop UI for the Berkeley Assignment Reminder."""

import queue
import threading
import time
import tkinter as tk
import tkinter.font as tkfont
from datetime import datetime, timezone
from tkinter import ttk

import schedule

import config
from canvas_client import cookies_valid as canvas_cookies_valid, login_via_calnet as canvas_login_via_calnet
from db import is_completed, mark_completed, unmark_completed
from gradescope_client import cookies_valid as gs_cookies_valid, login_via_calnet as gs_login_via_calnet
from main import check_and_notify, validate_config

# Interval (ms) for the UI to poll the background queue
_POLL_MS = 500


class ReminderApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Berkeley Assignment Reminder")
        self.root.geometry("720x480")
        self.root.minsize(600, 380)

        self.queue: queue.Queue = queue.Queue()
        self.last_check: datetime | None = None
        self.assignments: list[dict] = []
        self._tray_icon = None

        self._build_ui()
        self._start_scheduler()
        self.root.after(_POLL_MS, self._poll_queue)

        # On close: minimize to tray if available, else quit
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Kick off an initial refresh
        self._trigger_refresh()

    # ── UI construction ─────────────────────────────────────

    def _build_ui(self):
        # Status frame (top)
        status_frame = ttk.LabelFrame(self.root, text="Account Status", padding=8)
        status_frame.pack(fill=tk.X, padx=10, pady=(10, 4))

        row_canvas = ttk.Frame(status_frame)
        row_canvas.pack(fill=tk.X, pady=2)
        ttk.Label(row_canvas, text="Canvas:").pack(side=tk.LEFT)
        self.canvas_status = ttk.Label(row_canvas, text="Checking…")
        self.canvas_status.pack(side=tk.LEFT, padx=(6, 12))
        ttk.Button(row_canvas, text="Re-sign in", command=self._on_canvas_login).pack(side=tk.LEFT)

        row_gs = ttk.Frame(status_frame)
        row_gs.pack(fill=tk.X, pady=2)
        ttk.Label(row_gs, text="Gradescope:").pack(side=tk.LEFT)
        self.gs_status = ttk.Label(row_gs, text="Checking…")
        self.gs_status.pack(side=tk.LEFT, padx=(6, 12))
        ttk.Button(row_gs, text="Re-sign in", command=self._on_gs_login).pack(side=tk.LEFT)

        # Assignment list (center)
        list_frame = ttk.LabelFrame(self.root, text="Upcoming Assignments", padding=4)
        list_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=4)

        cols = ("done", "course", "assignment", "due", "source")
        self.tree = ttk.Treeview(list_frame, columns=cols, show="headings", selectmode="browse")
        self.tree.heading("done", text="\u2713")
        self.tree.heading("course", text="Course")
        self.tree.heading("assignment", text="Assignment")
        self.tree.heading("due", text="Due Date")
        self.tree.heading("source", text="Source")

        self.tree.column("done", width=40, minwidth=40, stretch=False, anchor="center")
        self.tree.column("course", width=140, minwidth=80)
        self.tree.column("assignment", width=240, minwidth=120)
        self.tree.column("due", width=170, minwidth=120)
        self.tree.column("source", width=90, minwidth=60)

        # Strikethrough font for completed assignments
        self._strike_font = tkfont.Font(font=("TkDefaultFont",), overstrike=True)

        # Color tags for urgency
        self.tree.tag_configure("urgent", foreground="#cc0000")   # <3h
        self.tree.tag_configure("warning", foreground="#cc7700")  # <24h
        self.tree.tag_configure("completed", foreground="#999999", font=self._strike_font)

        scrollbar = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        # Single-click to toggle checkbox (Button-1 = press, more reliable than Release on Windows)
        self.tree.bind("<Button-1>", self._on_tree_click)
        # Double-click to open in browser
        self.tree.bind("<Double-1>", self._on_tree_double_click)

        # Bottom bar
        bottom = ttk.Frame(self.root, padding=(10, 4, 10, 10))
        bottom.pack(fill=tk.X)

        self.lbl_last = ttk.Label(bottom, text="Last checked: –")
        self.lbl_last.pack(side=tk.LEFT)

        self.lbl_next = ttk.Label(bottom, text="")
        self.lbl_next.pack(side=tk.LEFT, padx=(20, 0))

        ttk.Button(bottom, text="Refresh Now", command=self._trigger_refresh).pack(side=tk.RIGHT)

        # Tick the countdown every second
        self._update_countdown()

    # ── Background scheduler ────────────────────────────────

    def _start_scheduler(self):
        schedule.every(config.CHECK_INTERVAL_MINUTES).minutes.do(
            self._enqueue_check
        )
        t = threading.Thread(target=self._scheduler_loop, daemon=True)
        t.start()

    def _scheduler_loop(self):
        while True:
            schedule.run_pending()
            time.sleep(10)

    def _enqueue_check(self):
        """Run check_and_notify in a thread so it doesn't block the scheduler."""
        threading.Thread(target=self._background_check, daemon=True).start()

    def _background_check(self):
        try:
            result = check_and_notify()
            self.queue.put(("assignments", result or []))
        except Exception as e:
            self.queue.put(("error", str(e)))

    def _trigger_refresh(self):
        """Manually refresh — called by the Refresh button and on startup."""
        self._set_status_labels_checking()
        threading.Thread(target=self._background_refresh, daemon=True).start()

    def _background_refresh(self):
        """Full refresh: check account status + fetch assignments."""
        # Account status
        try:
            canvas_ok = canvas_cookies_valid()
        except Exception:
            canvas_ok = False
        try:
            gs_ok = gs_cookies_valid()
        except Exception:
            gs_ok = False
        self.queue.put(("status", (canvas_ok, gs_ok)))

        # Assignments
        self._background_check()

    # ── Queue polling (runs on main thread) ─────────────────

    def _poll_queue(self):
        while not self.queue.empty():
            msg_type, payload = self.queue.get_nowait()
            if msg_type == "assignments":
                self._update_assignment_list(payload)
            elif msg_type == "status":
                canvas_ok, gs_ok = payload
                self._update_status_labels(canvas_ok, gs_ok)
            elif msg_type == "error":
                print(f"[UI] background error: {payload}")
            elif msg_type == "canvas_login":
                success = payload
                self.canvas_status.config(
                    text="Connected" if success else "Not connected",
                    foreground="green" if success else "red",
                )
                if success:
                    self._trigger_refresh()
            elif msg_type == "gs_login":
                success = payload
                self.gs_status.config(
                    text="Connected" if success else "Not connected",
                    foreground="green" if success else "red",
                )
                if success:
                    self._trigger_refresh()
        self.root.after(_POLL_MS, self._poll_queue)

    # ── Status helpers ──────────────────────────────────────

    def _set_status_labels_checking(self):
        self.canvas_status.config(text="Checking…", foreground="gray")
        self.gs_status.config(text="Checking…", foreground="gray")

    def _update_status_labels(self, canvas_ok: bool, gs_ok: bool):
        self.canvas_status.config(
            text="Connected" if canvas_ok else "Not connected",
            foreground="green" if canvas_ok else "red",
        )
        self.gs_status.config(
            text="Connected" if gs_ok else "Not connected",
            foreground="green" if gs_ok else "red",
        )

    # ── Assignment list ─────────────────────────────────────

    def _is_assignment_completed(self, a: dict) -> bool:
        return a.get("submitted", False) or is_completed(a["id"], a["source"])

    def _get_sorted_assignments(self) -> list[dict]:
        """Return assignments sorted: uncompleted by due date, then completed by due date."""
        completed = []
        uncompleted = []
        for a in self.assignments:
            if self._is_assignment_completed(a):
                completed.append(a)
            else:
                uncompleted.append(a)
        uncompleted.sort(key=lambda x: x["due_at"])
        completed.sort(key=lambda x: x["due_at"])
        return uncompleted + completed

    @staticmethod
    def _assignment_iid(a: dict) -> str:
        return f"{a['source']}|{a['id']}"

    def _find_assignment_by_iid(self, iid: str) -> dict | None:
        for a in self.assignments:
            if self._assignment_iid(a) == iid:
                return a
        return None

    def _render_tree(self):
        self.tree.delete(*self.tree.get_children())

        now = datetime.now(timezone.utc)
        for a in self._get_sorted_assignments():
            done = self._is_assignment_completed(a)

            if done:
                tag = "completed"
                check = "\u2611"
            elif (a["due_at"] - now).total_seconds() / 3600 < 3:
                tag = "urgent"
                check = "\u2610"
            elif (a["due_at"] - now).total_seconds() / 3600 < 24:
                tag = "warning"
                check = "\u2610"
            else:
                tag = ""
                check = "\u2610"

            due_local = a["due_at"].astimezone()
            due_str = due_local.strftime("%b %#d  %#I:%M %p")

            self.tree.insert(
                "", tk.END,
                iid=self._assignment_iid(a),
                values=(check, a["course_name"], a["name"], due_str, a["source"].title()),
                tags=(tag,),
            )

    def _update_assignment_list(self, assignments: list[dict]):
        self.assignments = assignments
        self.last_check = datetime.now()
        self._render_tree()
        self.lbl_last.config(text=f"Last checked: {self.last_check.strftime('%#I:%M %p')}")

    def _update_countdown(self):
        if self.last_check:
            elapsed = (datetime.now() - self.last_check).total_seconds()
            remaining = max(0, config.CHECK_INTERVAL_MINUTES * 60 - elapsed)
            mins = int(remaining // 60)
            self.lbl_next.config(text=f"Next check: {mins} min")
        self.root.after(1000, self._update_countdown)

    # ── Button handlers ─────────────────────────────────────

    def _on_canvas_login(self):
        self.canvas_status.config(text="Signing in…", foreground="gray")
        threading.Thread(target=self._canvas_login_thread, daemon=True).start()

    def _canvas_login_thread(self):
        success = canvas_login_via_calnet()
        self.queue.put(("canvas_login", success))

    def _on_gs_login(self):
        self.gs_status.config(text="Signing in…", foreground="gray")
        threading.Thread(target=self._gs_login_thread, daemon=True).start()

    def _gs_login_thread(self):
        success = gs_login_via_calnet()
        self.queue.put(("gs_login", success))

    def _on_tree_click(self, event):
        """Toggle the done checkbox when clicking on the done column."""
        col = self.tree.identify_column(event.x)
        if col != "#1":  # "#1" is the first column (done)
            return
        row_id = self.tree.identify_row(event.y)
        if not row_id:
            return
        a = self._find_assignment_by_iid(row_id)
        if not a:
            return

        # Auto-submitted assignments cannot be manually toggled off
        if a.get("submitted", False):
            return "break"

        if is_completed(a["id"], a["source"]):
            unmark_completed(a["id"], a["source"])
        else:
            mark_completed(a["id"], a["source"])
        self._render_tree()
        return "break"

    def _on_tree_double_click(self, event):
        # Ignore double-click on the done column
        if self.tree.identify_column(event.x) == "#1":
            return
        sel = self.tree.selection()
        if not sel:
            return
        a = self._find_assignment_by_iid(sel[0])
        if a:
            url = a.get("url")
            if url:
                import webbrowser
                webbrowser.open(url)

    # ── Window close / system tray ──────────────────────────

    def _on_close(self):
        if self._try_minimize_to_tray():
            return
        self.root.destroy()

    def _try_minimize_to_tray(self) -> bool:
        """Minimize to system tray if pystray is available. Returns True if successful."""
        try:
            import pystray
            from PIL import Image, ImageDraw
        except ImportError:
            return False

        self.root.withdraw()

        # Create a simple icon (blue square with white "R")
        img = Image.new("RGB", (64, 64), "#003262")  # Berkeley blue
        draw = ImageDraw.Draw(img)
        draw.text((22, 14), "R", fill="white")

        menu = pystray.Menu(
            pystray.MenuItem("Open", self._tray_open, default=True),
            pystray.MenuItem("Quit", self._tray_quit),
        )
        self._tray_icon = pystray.Icon("reminder", img, "Assignment Reminder", menu)
        threading.Thread(target=self._tray_icon.run, daemon=True).start()
        return True

    def _tray_open(self, _icon=None, _item=None):
        if self._tray_icon:
            self._tray_icon.stop()
            self._tray_icon = None
        self.root.after(0, self.root.deiconify)

    def _tray_quit(self, _icon=None, _item=None):
        if self._tray_icon:
            self._tray_icon.stop()
            self._tray_icon = None
        self.root.after(0, self.root.destroy)


def main():
    validate_config()
    root = tk.Tk()
    ReminderApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
