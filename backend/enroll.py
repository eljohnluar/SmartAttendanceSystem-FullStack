"""Guided enrollment: capture a finger on the USB scanner, then save its student.

    python enroll.py

Useful when the web form is not handy; both paths end with the same merged
template in students.fingerprint_template, which is what rebuilds the scanner's
memory after a restart.
"""

from __future__ import annotations

import sys
import time
from datetime import datetime

from capture import SCANS
from config import load_settings
from db import build_store
from scanner import SimulatedScanner, open_scanner
from sync import encode, remember


def _prompt(label: str) -> str:
    while True:
        value = input(f"{label}: ").strip()
        if value:
            return value
        print(f"  {label} is required.")


def _next_id(store) -> int:
    ids = [int(row["fingerprint_id"]) for row in store.roster() if row.get("fingerprint_id")]
    return max(ids, default=0) + 1


def _choose_id(store) -> int:
    suggested = _next_id(store)
    while True:
        raw = input(f"Fingerprint ID [{suggested}]: ").strip() or str(suggested)
        if not raw.isdigit():
            print("  Please type a whole number.")
            continue
        fid = int(raw)
        if store.get_student(fid):
            print(f"  ID {fid} already belongs to someone else. Pick another.")
            continue
        return fid


def _capture(scanner, timeout_seconds: int = 90) -> list[bytes] | None:
    """Three presses of the same finger, or None when the run falls apart."""
    print(f"\nPress the finger on the scanner {SCANS} times, lifting it fully between presses.")
    if not isinstance(scanner, SimulatedScanner):
        input("Press Enter when ready…")
    else:
        print("[enroll] Simulator: type  e <id>  three times.")
    scans: list[bytes] = []
    deadline = time.time() + timeout_seconds
    while len(scans) < SCANS:
        if time.time() > deadline:
            print("[enroll] Timed out waiting for a finger.")
            return None
        template = scanner.next_scan(0.5)
        if template is None or SimulatedScanner.is_quit(template):
            continue
        if scans and not scanner.same_finger(scans[-1], template):
            print("[enroll] That looked like a different finger, so the run stopped.")
            return None
        scans.append(template)
        print(f"[enroll] Scan {len(scans)} of {SCANS} taken.")
    return scans


def main() -> int:
    settings = load_settings()
    store = build_store(settings)

    # Questions first: the simulator pumps stdin, so prompting while it runs
    # would race for the same keystrokes.
    try:
        student = {
            "fingerprint_id": _choose_id(store),
            "first_name": _prompt("First name"),
            "last_name": _prompt("Last name"),
            "grade_level": _prompt("Grade level"),
            "parent_email": _prompt("Parent email address").lower(),
        }
    except (KeyboardInterrupt, EOFError):
        store.close()
        return 1

    scanner = open_scanner(settings)
    print(f"Smart Attendance enrollment — {getattr(scanner, 'label', 'scanner')}")

    try:
        scans = _capture(scanner)
        if not scans:
            print("[enroll] Enrollment cancelled.")
            return 1

        enrolled = scanner.merge(scans)
        blob = encode(enrolled)
        scanner.add(student["fingerprint_id"], enrolled)
        remember(student["fingerprint_id"], blob)
        student["fingerprint_template"] = blob
        store.insert_student(student)

        print(
            f"\n[enroll] Saved {student['first_name']} {student['last_name']} "
            f"as fingerprint ID {student['fingerprint_id']} ({store.name} store) at {datetime.now():%H:%M}."
        )
        return 0
    finally:
        scanner.stop()
        store.close()


if __name__ == "__main__":
    sys.exit(main())
