"""Drives fingerprint captures that the web form queues.

The browser cannot touch the scanner, so the form writes a pending row and this
module performs the enrollment on the device: three presses of the same finger,
merged into one template that is saved against the student. Captured prints
arrive from the same stream as attendance scans, so while a capture is running
the service hands every template here instead of matching it.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from sync import encode, forget, remember

SCANS = 3
CAPTURE_TIMEOUT_SECONDS = 90
PRUNE_INTERVAL_SECONDS = 300

STAGE_KEYS = [f"place_{i + 1}" for i in range(SCANS)]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class CaptureDriver:
    def __init__(self, store, scanner, timeout: float = CAPTURE_TIMEOUT_SECONDS) -> None:
        self.store = store
        self.scanner = scanner
        self.timeout = timeout
        self.active: dict | None = None
        self.deadline = 0.0
        self._scans: list[bytes] = []
        self._warned = False
        self._last_prune = 0.0

    @property
    def busy(self) -> bool:
        return bool(self.active)

    # ── queue ────────────────────────────────────────────────────────────
    def poll_if_idle(self) -> None:
        if self.active or self.store.name != "supabase":
            return
        try:
            pending = self.store.next_capture()
        except Exception as error:
            # Almost always means schema.sql has not been re-run for this table.
            if not self._warned:
                print(f"[capture] Capture queue unavailable, skipping: {error}")
                self._warned = True
            return

        self._warned = False
        if pending:
            self._begin(pending)

    def _begin(self, pending: dict) -> None:
        target = pending.get("target_slot")
        if not target:
            self._settle(pending["id"], {"status": "failed", "error": "A capture needs a Fingerprint ID"})
            return

        self.active = pending
        self._scans = []
        self.deadline = time.time() + self.timeout
        try:
            self.store.update_capture(
                pending["id"], {"status": "capturing", "error": None, "updated_at": _now()}
            )
        except Exception as error:
            self.active = None
            print(f"[capture] Could not claim the request: {error}")
            return

        # A transferred student's old print would still match their finger and
        # could be handed to whoever takes that ID next, so drop it first.
        if (pending.get("action") or "enroll") == "delete":
            self._clear(target)
            return

        student = self.store.get_student(target)
        if student is None:
            self._fail(pending["id"], "NO_STUDENT")
            print(f"[capture] No student is saved under fingerprint ID {target} yet.")
            return

        name = f"{student['first_name']} {student['last_name']}".strip()
        print(f"[capture] Enrolling {name} as fingerprint ID {target}: press the finger {SCANS} times.")
        self._advance(STAGE_KEYS[0], f"Scan 1 of {SCANS} - press the finger flat and hold still")

    # ── template stream ──────────────────────────────────────────────────
    def handle_template(self, template: bytes) -> None:
        """Consumes one captured print of the enrollment."""
        if not self.active:
            return
        pending = self.active
        target = int(pending["target_slot"])
        taken = len(self._scans)

        if taken and not self.scanner.same_finger(self._scans[-1], template):
            self._fail(pending["id"], "TEMPLATES_DID_NOT_MATCH")
            print("[capture] That looked like a different finger, so the enrollment stopped.")
            return

        self._scans.append(template)
        taken += 1
        if taken < SCANS:
            self._advance(STAGE_KEYS[taken], f"Scan {taken + 1} of {SCANS} - lift, then press the same finger again")
            return

        self._advance("merge", "Merging the three scans…")
        try:
            enrolled = self.scanner.merge(self._scans)
            self.scanner.discard(target)
            self.scanner.add(target, enrolled)
        except Exception as error:
            self._fail(pending["id"], f"MERGE_FAILED: {error}")
            return


        blob = encode(enrolled)
        try:
            saved = self.store.save_template(target, blob)
        except Exception as error:
            self._fail(pending["id"], f"SAVE_FAILED: {error}")
            print(f"[capture] Could not store the template: {error}")
            return

        if not saved:
            # The row went away mid-capture; keep the device honest by dropping the print.
            self.scanner.discard(target)
            self._fail(pending["id"], "NO_STUDENT")
            return


        remember(target, blob)
        self._settle(pending["id"], {"status": "done", "step": None, "fingerprint_id": target})
        print(f"[capture] Fingerprint ID {target} enrolled and ready for scans.")

    def check_timeout(self) -> None:
        if self.active and time.time() > self.deadline:
            self._fail(self.active["id"], "TIMEOUT")
            print("[capture] Timed out waiting for a finger")

    # ── clearing ─────────────────────────────────────────────────────────
    def _clear(self, fid: int) -> None:
        capture_id = self.active["id"]
        try:
            self.scanner.remove(fid)
            self.store.clear_template(fid)
        except Exception as error:
            self._settle(capture_id, {"status": "failed", "error": str(error)[:300]})
            print(f"[capture] Could not clear fingerprint ID {fid}: {error}")
            return

        forget(fid)
        self._settle(capture_id, {"status": "done", "step": None, "fingerprint_id": None})
        print(f"[capture] Fingerprint ID {fid} cleared.")

    # ── bookkeeping ──────────────────────────────────────────────────────
    def _advance(self, step: str, message: str) -> None:
        """Publishes the stage the scanner reached so the web form can coach the user."""
        try:
            self.store.update_capture(self.active["id"], {"step": step, "updated_at": _now()})
        except Exception as error:
            print(f"[capture] Could not record the stage: {error}")
        print(f"[capture] {message}")

    def _fail(self, capture_id: str, reason: str) -> None:
        status = "expired" if reason == "TIMEOUT" else "failed"
        self._settle(capture_id, {"status": status, "step": None, "error": reason[:300]})

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

    def _settle(self, capture_id: str, changes: dict) -> None:
        self.active = None
        self._scans = []
        try:
            self.store.update_capture(capture_id, {"updated_at": _now(), **changes})
        except Exception as error:
            print(f"[capture] Could not record the result: {error}")
