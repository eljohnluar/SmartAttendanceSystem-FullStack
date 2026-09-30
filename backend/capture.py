"""Drives fingerprint captures that the web form queues.

The browser cannot open the COM port, so the form writes a pending row and this
module performs the two-stage capture on the sensor and writes the resulting
memory slot back. One capture runs at a time; while it is waiting, incoming
serial lines belong to it and are not treated as attendance scans.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

CAPTURE_TIMEOUT_SECONDS = 75
PRUNE_INTERVAL_SECONDS = 300


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CaptureDriver:
    def __init__(self, store, timeout: float = CAPTURE_TIMEOUT_SECONDS) -> None:
        self.store = store
        self.timeout = timeout
        self.active: dict | None = None
        self.deadline = 0.0
        self._warned = False
        self._last_prune = 0.0

    def poll_if_idle(self, link) -> None:
        if self.active or self.store.name != "supabase":
            return
        try:
            pending = self.store.next_capture()
        except Exception as error:
            if not self._warned:
                print(f"[capture] Capture queue unavailable, skipping: {error}")
                self._warned = True
            return

        self._warned = False
        if not pending:
            return

        # Ask for the student's own Fingerprint ID so the sensor slot and the
        # database row cannot drift apart.
        target = pending.get("target_slot")
        self.active = pending
        self.deadline = time.time() + self.timeout

        # A transferred student's old template would still match their finger
        # and could be handed to whoever gets that slot next, so clear it.
        if (pending.get("action") or "enroll") == "delete":
            if not target:
                self._settle({"status": "failed", "error": "A clear needs a target slot"})
                return
            link.send(f"D:{target}")
            self.store.update_capture(pending["id"], {"status": "capturing", "updated_at": _now()})
            print(f"[capture] Clearing stale slot {target} on the sensor…")
            return

        link.send(f"E:{target}" if target else "E")
        self.store.update_capture(pending["id"], {"status": "capturing", "updated_at": _now()})
        print(f"[capture] Sensor is listening for a finger (slot {target or 'auto'})…")

    def handle_line(self, line: str) -> bool:
        """True when the line was consumed by the capture."""
        if not self.active:
            return False

        verb, _, value = line.upper().partition(":")
        if verb == "ENROLLED" and value.strip().isdigit():
            captured = int(value.strip())
            self._settle({"status": "done", "fingerprint_id": captured})
            print(f"[capture] Stored as fingerprint ID {captured}")
            return True
        if verb == "DELETED" and value.strip().isdigit():
            cleared = int(value.strip())
            self._settle({"status": "done", "fingerprint_id": None})
            print(f"[capture] Stale slot {cleared} cleared on the sensor")
            return True
        if verb == "ERROR":
            reason = line.split(":", 1)[1] if ":" in line else line
            self._settle({"status": "failed", "error": reason[:300]})
            print(f"[capture] Sensor reported: {reason}")
            return True

        if verb == "ENROL_WAIT_1":
            self._advance("place_1", "Stage 1 of 2 — press the finger flat and hold still")
        elif verb == "ENROL_SEEN_1":
            self._advance("seen_1", "Finger detected — reading the first print")
        elif verb == "ENROL_LIFT":
            self._advance("lift", "First print taken — lift the finger off the sensor")
        elif verb == "ENROL_WAIT_2":
            self._advance("place_2", "Stage 2 of 2 — press the same finger again")
        elif verb == "ENROL_SEEN_2":
            self._advance("seen_2", "Finger detected — reading the second print")
        self.check_timeout()
        return True

    def check_timeout(self) -> None:
        if self.active and time.time() > self.deadline:
            self._settle({"status": "expired", "error": "No finger was captured in time"})
            print("[capture] Timed out waiting for a finger")

    def _advance(self, step: str, message: str) -> None:
        """Publishes the stage the sensor reached so the web form can coach the user."""
        try:
            self.store.update_capture(self.active["id"], {"step": step, "updated_at": _now()})
        except Exception as error:
            print(f"[capture] Could not record the stage: {error}")
        print(f"[capture] {message}")

    def maybe_prune(self) -> None:
        if self.store.name != "supabase":
            return
        now = time.time()
        if now - self._last_prune < PRUNE_INTERVAL_SECONDS:
            return
        self._last_prune = now
        try:
            self.store.prune_captures()
        except Exception:
            pass

    def _settle(self, changes: dict) -> None:
        capture_id = self.active["id"]
        self.active = None
        try:
            self.store.update_capture(capture_id, {"error": None, "updated_at": _now(), **changes})
        except Exception as error:
            print(f"[capture] Could not record the result: {error}")
