"""Local SQLite store: the scanner's source of truth when there is no internet.

The database lives in C:\\Users\\Public\\SmartAttendance\\ so that a per-user or
admin install never fights Windows over write permissions inside Program Files.

Every scan is written here first (email_status='PENDING'), so the kiosk keeps
working with the cable pulled. worker.py drains the email queue and mirrors
rows to Supabase later, whenever the network is back.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path

APP_DIR_NAME = "SmartAttendance"
DB_FILE_NAME = "attendance.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    fingerprint_id INTEGER UNIQUE,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    grade_level TEXT DEFAULT '',
    section TEXT DEFAULT '',
    parent_email TEXT DEFAULT '',
    fingerprint_template TEXT,
    updated_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS attendance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT NOT NULL,
    scan_time TEXT NOT NULL,
    status TEXT NOT NULL,
    email_status TEXT NOT NULL DEFAULT 'PENDING',
    email_attempts INTEGER NOT NULL DEFAULT 0,
    parent_email TEXT DEFAULT '',
    student_name TEXT DEFAULT '',
    grade_level TEXT DEFAULT '',
    synced INTEGER NOT NULL DEFAULT 0,
    cloud_id TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_logs_email ON attendance_logs(email_status);
CREATE INDEX IF NOT EXISTS idx_logs_synced ON attendance_logs(synced);
CREATE INDEX IF NOT EXISTS idx_logs_student ON attendance_logs(student_id);
CREATE TABLE IF NOT EXISTS grade_settings (
    grade_level TEXT PRIMARY KEY,
    school_start TEXT,
    late_grace_minutes INTEGER
);
CREATE TABLE IF NOT EXISTS backend_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    connected INTEGER,
    port TEXT,
    last_heartbeat TEXT,
    scans_today INTEGER DEFAULT 0,
    message TEXT
);
"""

# email_status values: PENDING (queued) -> SENT, or NO_EMAIL at insert time,
# or FAILED once the queue gives up on an address.
MAX_EMAIL_ATTEMPTS = 20


def default_db_path() -> Path:
    """Where attendance.db lives: a public, always-writable folder on Windows."""
    override = (os.getenv("ATTENDANCE_DB") or "").strip()
    if override:
        return Path(override)
    if sys.platform == "win32":
        public = Path(os.getenv("PUBLIC") or r"C:\Users\Public")
        return public / APP_DIR_NAME / DB_FILE_NAME
    return Path.home() / APP_DIR_NAME / DB_FILE_NAME


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteStore:
    """Same duck-type as the other stores, but never leaves this machine."""

    name = "sqlite"

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or default_db_path()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(self.path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.commit()

    # ── students ─────────────────────────────────────────────────────────
    def get_student(self, fingerprint_id: int) -> dict | None:
        row = self._fetchone(
            "SELECT * FROM students WHERE fingerprint_id = ?", (int(fingerprint_id),)
        )
        return dict(row) if row else None

    def roster(self) -> list[dict]:
        rows = self._fetchall(
            "SELECT id,fingerprint_id,first_name,last_name,fingerprint_template"
            " FROM students WHERE fingerprint_id IS NOT NULL ORDER BY fingerprint_id"
        )
        return [dict(r) for r in rows]

    def upsert_students(self, students: list[dict]) -> int:
        """Mirrors the Supabase roster into the local DB. Returns rows written."""
        written = 0
        with self._lock:
            for row in students:
                if row.get("id") is None:
                    continue
                self._db.execute(
                    """
                    INSERT INTO students (id, fingerprint_id, first_name, last_name,
                        grade_level, section, parent_email, fingerprint_template, updated_at)
                    VALUES (:id, :fingerprint_id, :first_name, :last_name,
                        :grade_level, :section, :parent_email, :fingerprint_template, :updated_at)
                    ON CONFLICT(id) DO UPDATE SET
                        fingerprint_id = excluded.fingerprint_id,
                        first_name = excluded.first_name,
                        last_name = excluded.last_name,
                        grade_level = excluded.grade_level,
                        section = excluded.section,
                        parent_email = excluded.parent_email,
                        fingerprint_template = excluded.fingerprint_template,
                        updated_at = excluded.updated_at
                    """,
                    {
                        "id": str(row["id"]),
                        "fingerprint_id": row.get("fingerprint_id"),
                        "first_name": row.get("first_name") or "",
                        "last_name": row.get("last_name") or "",
                        "grade_level": row.get("grade_level") or "",
                        "section": row.get("section") or "",
                        "parent_email": row.get("parent_email") or "",
                        "fingerprint_template": row.get("fingerprint_template"),
                        "updated_at": _now_iso(),
                    },
                )
                written += 1
            self._db.commit()
        return written

    def save_template(self, fingerprint_id: int, template_b64: str) -> int:
        return self._set_template(int(fingerprint_id), template_b64)

    def clear_template(self, fingerprint_id: int) -> int:
        return self._set_template(int(fingerprint_id), None)

    def _set_template(self, fingerprint_id: int, template_b64: str | None) -> int:
        with self._lock:
            cursor = self._db.execute(
                "UPDATE students SET fingerprint_template = ?, updated_at = ?"
                " WHERE fingerprint_id = ?",
                (template_b64, _now_iso(), fingerprint_id),
            )
            self._db.commit()
        return cursor.rowcount

    def insert_student(self, student: dict) -> dict:
        """Offline-capable enrollment write: id is generated when missing."""
        import uuid

        row = dict(student)
        row.setdefault("id", uuid.uuid4().hex)
        row["id"] = str(row["id"])
        with self._lock:
            self._db.execute(
                """
                INSERT OR REPLACE INTO students (id, fingerprint_id, first_name, last_name,
                    grade_level, section, parent_email, fingerprint_template, updated_at)
                VALUES (:id, :fingerprint_id, :first_name, :last_name,
                    :grade_level, :section, :parent_email, :fingerprint_template, :updated_at)
                """,
                {
                    "id": row["id"],
                    "fingerprint_id": row.get("fingerprint_id"),
                    "first_name": row.get("first_name") or "",
                    "last_name": row.get("last_name") or "",
                    "grade_level": row.get("grade_level") or "",
                    "section": row.get("section") or "",
                    "parent_email": row.get("parent_email") or "",
                    "fingerprint_template": row.get("fingerprint_template"),
                    "updated_at": _now_iso(),
                },
            )
            self._db.commit()
        return row

    # ── attendance ───────────────────────────────────────────────────────
    def insert_attendance(self, log: dict) -> dict:
        with self._lock:
            cursor = self._db.execute(
                """
                INSERT INTO attendance_logs (student_id, scan_time, status, email_status,
                    parent_email, student_name, grade_level)
                VALUES (:student_id, :scan_time, :status, :email_status,
                    :parent_email, :student_name, :grade_level)
                """,
                {
                    "student_id": str(log["student_id"]),
                    "scan_time": log["scan_time"],
                    "status": log.get("status") or "Present",
                    "email_status": log.get("email_status") or "PENDING",
                    "parent_email": log.get("parent_email") or "",
                    "student_name": log.get("student_name") or "",
                    "grade_level": log.get("grade_level") or "",
                },
            )
            self._db.commit()
            log_id = cursor.lastrowid
        return {**log, "id": log_id, "synced": 0}

    def update_attendance(self, log_id, changes: dict) -> None:
        # Local ids are ints; cloud updates go through SupabaseStore instead.
        if "email_status" in changes:
            self.set_email_status(log_id, changes["email_status"])

    def latest_scan_for_student(self, student_id: str) -> dict | None:
        row = self._fetchone(
            "SELECT scan_time FROM attendance_logs WHERE student_id = ?"
            " ORDER BY id DESC LIMIT 1",
            (str(student_id),),
        )
        return dict(row) if row else None

    def queue_counts(self) -> dict:
        pending = self._fetchone("SELECT COUNT(*) AS n FROM attendance_logs WHERE email_status='PENDING'")
        unsent = self._fetchone("SELECT COUNT(*) AS n FROM attendance_logs WHERE synced=0")
        return {
            "email_pending": pending["n"] if pending else 0,
            "logs_to_sync": unsent["n"] if unsent else 0,
        }

    # ── email queue ──────────────────────────────────────────────────────
    def pending_emails(self, limit: int = 20) -> list[dict]:
        rows = self._fetchall(
            "SELECT * FROM attendance_logs WHERE email_status='PENDING'"
            " ORDER BY id LIMIT ?",
            (limit,),
        )
        return [dict(r) for r in rows]

    def set_email_status(self, log_id: int, status: str) -> None:
        with self._lock:
            self._db.execute(
                "UPDATE attendance_logs SET email_status = ? WHERE id = ?", (status, int(log_id))
            )
            self._db.commit()

    def bump_email_attempt(self, log_id: int) -> int:
        with self._lock:
            self._db.execute(
                "UPDATE attendance_logs SET email_attempts = email_attempts + 1 WHERE id = ?",
                (int(log_id),),
            )
            self._db.commit()
            row = self._db.execute(
                "SELECT email_attempts FROM attendance_logs WHERE id = ?", (int(log_id),)
            ).fetchone()
        return int(row["email_attempts"]) if row else 0

    # ── sync bookkeeping ─────────────────────────────────────────────────
    def unsynced_logs(self, limit: int = 50) -> list[dict]:
        rows = self._fetchall(
            "SELECT * FROM attendance_logs WHERE synced = 0 ORDER BY id LIMIT ?", (limit,)
        )
        return [dict(r) for r in rows]

    def mark_log_synced(self, log_id: int, cloud_id: str = "") -> None:
        with self._lock:
            self._db.execute(
                "UPDATE attendance_logs SET synced = 1, cloud_id = ? WHERE id = ?",
                (str(cloud_id), int(log_id)),
            )
            self._db.commit()

    # ── settings & status ────────────────────────────────────────────────
    def grade_settings(self, grade: str) -> dict | None:
        row = self._fetchone(
            "SELECT * FROM grade_settings WHERE grade_level = ?", (grade,)
        )
        return dict(row) if row else None

    def replace_grade_settings(self, rows: list[dict]) -> None:
        with self._lock:
            self._db.execute("DELETE FROM grade_settings")
            for row in rows:
                grade = row.get("grade_level")
                if not grade:
                    continue
                self._db.execute(
                    "INSERT OR REPLACE INTO grade_settings (grade_level, school_start, late_grace_minutes)"
                    " VALUES (?, ?, ?)",
                    (grade, row.get("school_start"), row.get("late_grace_minutes")),
                )
            self._db.commit()

    def save_status(self, status: dict) -> None:
        with self._lock:
            self._db.execute(
                """
                INSERT INTO backend_status (id, connected, port, last_heartbeat, scans_today, message)
                VALUES (1, :connected, :port, :last_heartbeat, :scans_today, :message)
                ON CONFLICT(id) DO UPDATE SET
                    connected = excluded.connected,
                    port = excluded.port,
                    last_heartbeat = excluded.last_heartbeat,
                    scans_today = excluded.scans_today,
                    message = excluded.message
                """,
                {
                    "connected": 1 if status.get("connected") else 0,
                    "port": status.get("port") or "",
                    "last_heartbeat": status.get("last_heartbeat") or _now_iso(),
                    "scans_today": int(status.get("scans_today") or 0),
                    "message": status.get("message") or "",
                },
            )
            self._db.commit()

    # ── plumbing ─────────────────────────────────────────────────────────
    def _fetchone(self, sql: str, params: tuple = ()):
        with self._lock:
            return self._db.execute(sql, params).fetchone()

    def _fetchall(self, sql: str, params: tuple = ()):
        with self._lock:
            return self._db.execute(sql, params).fetchall()

    def ping(self) -> bool:
        self._fetchone("SELECT 1")
        return True

    def close(self) -> None:
        with self._lock:
            self._db.close()
