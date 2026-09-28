"""Guided enrollment: capture a finger on the sensor, then create its student row.

    python enroll.py
"""

from __future__ import annotations

import time
from datetime import datetime

from config import load_settings
from db import build_store
from serial_link import open_link


def _prompt(label: str) -> str:
    while True:
        value = input(f"{label}: ").strip()
        if value:
            return value
        print(f"  {label} is required.")


def _capture_fingerprint(link, timeout_seconds: int = 75) -> int | None:
    print("\nPlace the student's finger on the sensor and press Enter when ready.")
    input()
    link.send("E")
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        line = link.read_line()
        if line and line.upper().startswith("ENROLLED:"):
            captured = line.split(":", 1)[1].strip()
            return int(captured) if captured.isdigit() else None
    print("[enroll] Timed out waiting for the sensor.")
    return None


def main() -> int:
    settings = load_settings()
    store = build_store(settings)
    link = open_link(settings)

    try:
        fingerprint_id = _capture_fingerprint(link)
        if fingerprint_id is None:
            print("[enroll] Enrollment cancelled.")
            return 1

        existing = store.get_student(fingerprint_id)
        if existing:
            print(
                f"[enroll] ID {fingerprint_id} already belongs to "
                f"{existing['first_name']} {existing['last_name']}. Pick another."
            )
            return 1

        print(f"\nSensor stored this print as fingerprint ID {fingerprint_id}.")
        student = {
            "fingerprint_id": fingerprint_id,
            "first_name": _prompt("First name"),
            "last_name": _prompt("Last name"),
            "grade_level": _prompt("Grade level"),
            "parent_email": _prompt("Parent Gmail address"),
        }
        store.insert_student(student)
        print(
            f"\n[enroll] Saved {student['first_name']} {student['last_name']} "
            f"({store.name} store) at {datetime.now():%H:%M}."
        )
        print(f"[enroll] Fingerprint ID to write on the Enrollment page: {fingerprint_id}")
        return 0
    finally:
        link.close()
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
