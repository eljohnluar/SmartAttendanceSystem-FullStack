"""The background thread that keeps the offline machine in touch with the world.

Every 30 seconds it:
  1. asks whether the internet is back (a TCP hello to 8.8.8.8 — no admin,
     no ICMP, works behind every school router),
  2. drains the SQLite email queue through Brevo, marking rows SENT,
  3. mirrors new scans to Supabase and pulls the roster back down, so prints
     enrolled on another device work here after one reboot-free resync.

Everything here is best-effort: an exception in one pass is logged and the
thread sleeps and tries again. The scan loop never waits on this one.
"""

from __future__ import annotations

import socket
import threading
from datetime import datetime

from database import MAX_EMAIL_ATTEMPTS

MAX_BULK = 50

# email_status values that mean "this row is finished with".
TERMINAL = {"SENT", "FAILED", "NO_EMAIL"}


def is_online(timeout: float = 3.0) -> bool:
    try:
        with socket.create_connection(("8.8.8.8", 53), timeout=timeout):
            return True
    except OSError:
        return False


class OfflineWorker:
    def __init__(self, settings, local, cloud, notifier) -> None:
        self.settings = settings
        self.local = local
        self.cloud = cloud
        self.notifier = notifier
        self.interval = settings.emailer_seconds
        self.last_result = "waiting"
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._loop, name="emailer-sync", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                self.run_once()
            except Exception as error:  # the thread must outlive any single failure
                self.last_result = f"error: {error}"
                print(f"[worker] {self.last_result}")

    # ── one pass ─────────────────────────────────────────────────────────
    def run_once(self) -> dict:
        counts = {"sent": 0, "send_failed": 0, "pushed": 0, "pulled": 0}
        if not is_online():
            self.last_result = "offline; queue holds"
            return counts

        counts.update(self.send_pending_emails())
        if self.cloud is not None:
            counts.update(self.sync_with_cloud())
        self.last_result = (
            f"sent {counts['sent']}, pushed {counts['pushed']}, pulled {counts['pulled']}"
        )
        return counts

    # ── email queue ──────────────────────────────────────────────────────
    def send_pending_emails(self) -> dict:
        sent = failed = 0
        for log in self.local.pending_emails(limit=MAX_BULK):
            if log["email_status"] in TERMINAL:
                continue
            first, _, last = log["student_name"].partition(" ")
            student = {
                "first_name": first,
                "last_name": last,
                "grade_level": log["grade_level"],
                "parent_email": log["parent_email"],
            }
            try:
                scan_time = datetime.fromisoformat(log["scan_time"])
            except ValueError:
                scan_time = datetime.now().astimezone()
            if self.notifier.notify_arrival(student, scan_time, log["status"]):
                self.local.set_email_status(log["id"], "SENT")
                sent += 1
            else:
                attempts = self.local.bump_email_attempt(log["id"])
                if attempts >= MAX_EMAIL_ATTEMPTS:
                    self.local.set_email_status(log["id"], "FAILED")
                    failed += 1
        return {"sent": sent, "send_failed": failed}

    # ── Supabase mirror ──────────────────────────────────────────────────
    def sync_with_cloud(self) -> dict:
        pushed = self.push_logs()
        pulled = self.pull_roster()
        try:
            self.local.replace_grade_settings(self.cloud.list_grade_settings())
        except Exception as error:
            print(f"[worker] Grade rules not refreshed: {error}")
        return {"pushed": pushed, "pulled": pulled}

    def push_logs(self) -> int:
        pushed = 0
        for log in self.local.unsynced_logs(limit=MAX_BULK):
            try:
                created = self.cloud.insert_attendance(
                    {
                        "student_id": log["student_id"],
                        "scan_time": log["scan_time"],
                        "status": log["status"],
                        "parent_notified": log["email_status"] == "SENT",
                    }
                )
            except Exception as error:
                print(f"[worker] Could not push scan {log['id']} to the cloud: {error}")
                break
            self.local.mark_log_synced(log["id"], created.get("id", ""))
            pushed += 1
        return pushed

    def pull_roster(self) -> int:
        try:
            students = self.cloud.list_students()
        except Exception as error:
            print(f"[worker] Could not pull the roster: {error}")
            return 0
        written = self.local.upsert_students(students)
        if written:
            print(f"[worker] Roster mirrored into SQLite ({written} student(s)).")
        return written
