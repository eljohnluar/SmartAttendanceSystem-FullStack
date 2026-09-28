"""Turns a fingerprint hit into an attendance row plus a parent email."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta

from db import SupabaseStore
from notifier import Notifier

# What a grade gets when it has no rule of its own. The Attendance page prefills
# the same pair, so an unsaved class behaves as the form suggests.
DEFAULT_START = time(8, 0)
DEFAULT_GRACE_MINUTES = 15

_warned_grades: set = set()


def parse_hhmm(raw, fallback: time) -> time:
    """Accepts "08:00" from the form and "08:00:00" from a Postgres time column."""
    try:
        hour, minute = (int(part) for part in raw.split(":")[:2])
        return time(hour % 24, minute % 60)
    except (ValueError, AttributeError):
        return fallback


def late_rule(store, grade: str | None) -> tuple[time, int]:
    """The grade's own threshold, or the default when none is saved.

    A missing table must never stop a scan from being logged, so a read failure
    falls back quietly — but says so once per grade.
    """
    default = (DEFAULT_START, DEFAULT_GRACE_MINUTES)
    try:
        row = store.grade_settings(grade) if grade else None
    except Exception as error:
        if grade not in _warned_grades:
            _warned_grades.add(grade)
            print(f"[scan] No late rule readable for {grade}, using the default: {error}")
        return default

    _warned_grades.discard(grade)
    if not row:
        return default
    grace = row.get("late_grace_minutes")
    return parse_hhmm(row.get("school_start"), default[0]), default[1] if grace is None else int(grace)


def _attendance_status(local_now: datetime, start: time, grace_minutes: int) -> str:
    school_start = start.replace(tzinfo=local_now.tzinfo)
    cutoff = datetime.combine(local_now.date(), school_start) + timedelta(minutes=grace_minutes)
    return "Late" if local_now > cutoff else "Present"


@dataclass
class ScanResult:
    kind: str  # logged | duplicate | unknown
    student: dict | None = None
    log: dict | None = None
    status: str = ""
    notified: bool = False

    @property
    def headline(self) -> str:
        if self.kind == "unknown":
            return "Unknown fingerprint"
        name = f"{self.student['first_name']} {self.student['last_name']}".strip()
        return f"{name} — {self.status}"


def _is_too_soon(previous_scan_iso: str | None, local_now: datetime, settings) -> bool:
    if not previous_scan_iso:
        return False
    try:
        previous = datetime.fromisoformat(previous_scan_iso)
    except ValueError:
        return False
    if previous.tzinfo is None:  # PostgREST sometimes omits the offset
        previous = previous.replace(tzinfo=local_now.tzinfo)
    return local_now - previous < timedelta(minutes=settings.duplicate_scan_minutes)


def handle_scan(store: SupabaseStore, notifier: Notifier, settings, fingerprint_id: int) -> ScanResult:
    student = store.get_student(fingerprint_id)
    if student is None:
        print(f"[scan] ID {fingerprint_id} is not enrolled — add it on the Enrollment page.")
        return ScanResult(kind="unknown")

    now = datetime.now().astimezone()
    previous = store.latest_scan_for_student(student["id"])
    if _is_too_soon(previous.get("scan_time") if previous else None, now, settings):
        print(f"[scan] {student['first_name']} already scanned moments ago — ignoring repeat.")
        return ScanResult(kind="duplicate", student=student)

    start, grace = late_rule(store, student.get("grade_level"))
    status = _attendance_status(now, start, grace)
    log = store.insert_attendance(
        {
            "student_id": student["id"],
            "scan_time": now.isoformat(),
            "status": status,
            "parent_notified": False,
        }
    )

    notified = notifier.notify_arrival(student, now, status)
    if notified:
        store.update_attendance(log["id"], {"parent_notified": True})
        log["parent_notified"] = True

    print(f"[scan] {student['first_name']} {student['last_name']} -> {status} at {now:%H:%M}")
    return ScanResult(kind="logged", student=student, log=log, status=status, notified=notified)
