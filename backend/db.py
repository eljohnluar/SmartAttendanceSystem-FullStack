"""Data access for Supabase (PostgREST) with a file-backed stand-in for demo runs.

Talks to PostgREST over httpx rather than supabase-py: the dependency is far
lighter and the REST calls are the same ones the client library makes.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

DEMO_FILE = Path(__file__).resolve().parent / "demo_data.json"

SEED_STUDENTS = [
    {"fingerprint_id": 1, "first_name": "Amara", "last_name": "Okafor", "grade_level": "Grade 5", "parent_email": "parent.amara@example.com"},
    {"fingerprint_id": 2, "first_name": "Daniel", "last_name": "Reyes", "grade_level": "Grade 6", "parent_email": "parent.daniel@example.com"},
    {"fingerprint_id": 3, "first_name": "Mei", "last_name": "Tan", "grade_level": "Grade 5", "parent_email": "parent.mei@example.com"},
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class SupabaseStore:
    """Rows are read/written with the service-role key, bypassing RLS."""

    name = "supabase"

    def __init__(self, url: str, key: str) -> None:
        self._base = f"{url}/rest/v1"
        self._auth_base = f"{url}/auth/v1"
        self._client = httpx.Client(
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(10.0, connect=5.0),
        )

    def _request(self, method: str, table: str, **kwargs: Any) -> httpx.Response:
        response = self._client.request(method, f"{self._base}/{table}", **kwargs)
        response.raise_for_status()
        return response

    def get_student(self, fingerprint_id: int) -> dict | None:
        rows = self._request(
            "GET",
            "students",
            params={"fingerprint_id": f"eq.{int(fingerprint_id)}", "select": "*", "limit": "1"},
        ).json()
        return rows[0] if rows else None

    def list_students(self) -> list[dict]:
        return self._request(
            "GET", "students", params={"select": "*", "order": "fingerprint_id.asc"}
        ).json()

    def insert_student(self, student: dict) -> dict:
        rows = self._request(
            "POST",
            "students",
            json=student,
            headers={"Prefer": "return=representation"},
        ).json()
        return rows[0]

    def insert_attendance(self, log: dict) -> dict:
        rows = self._request(
            "POST",
            "attendance_logs",
            json=log,
            headers={"Prefer": "return=representation"},
        ).json()
        return rows[0]

    def update_attendance(self, log_id: str, changes: dict) -> None:
        self._request(
            "PATCH",
            "attendance_logs",
            params={"id": f"eq.{log_id}"},
            json=changes,
            headers={"Prefer": "return=minimal"},
        )

    def latest_scan_for_student(self, student_id: str) -> dict | None:
        rows = self._request(
            "GET",
            "attendance_logs",
            params={
                "student_id": f"eq.{student_id}",
                "select": "scan_time",
                "order": "scan_time.desc",
                "limit": "1",
            },
        ).json()
        return rows[0] if rows else None

    def grade_settings(self, grade: str) -> dict | None:
        rows = self._request(
            "GET",
            "grade_settings",
            params={"grade_level": f"eq.{grade}", "select": "*", "limit": "1"},
        ).json()
        return rows[0] if rows else None

    def save_status(self, status: dict) -> None:
        self._request(
            "POST",
            "backend_status",
            json={"id": 1, **status},
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )

    def list_staff(self) -> list[dict]:
        return self._request(
            "GET", "staff_profiles", params={"select": "*", "order": "created_at.asc"}
        ).json()

    def update_staff(self, profile_id: str, changes: dict) -> None:
        self._request(
            "PATCH",
            "staff_profiles",
            params={"id": f"eq.{profile_id}"},
            json=changes,
            headers={"Prefer": "return=minimal"},
        )

    def create_auth_user(self, email: str, password: str, role: str, grade_level) -> dict:
        """GoTrue admin API — the one thing that cannot be done with an anon key."""
        payload = {
            "email": email,
            "password": password,
            "email_confirm": True,
            "app_metadata": {"role": role, "grade_level": grade_level},
        }
        response = self._client.request("POST", f"{self._auth_base}/admin/users", json=payload)
        response.raise_for_status()
        return response.json()

    def next_capture(self) -> dict | None:
        rows = self._request(
            "GET",
            "fingerprint_captures",
            params={"status": "eq.pending", "select": "*", "order": "created_at.asc", "limit": "1"},
        ).json()
        return rows[0] if rows else None

    def update_capture(self, capture_id: str, changes: dict) -> None:
        self._request(
            "PATCH",
            "fingerprint_captures",
            params={"id": f"eq.{capture_id}"},
            json=changes,
            headers={"Prefer": "return=minimal"},
        )

    def prune_captures(self, older_than_minutes: int = 60) -> None:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)).isoformat()
        self._request(
            "DELETE",
            "fingerprint_captures",
            params={"created_at": f"lt.{cutoff}", "status": "in.(done,failed,expired)"},
            headers={"Prefer": "return=minimal"},
        )

    def ping(self) -> bool:
        self._request("GET", "students", params={"select": "id", "limit": "1"})
        return True

    def close(self) -> None:
        self._client.close()


class LocalStore:
    """JSON-file store so the pipeline is runnable before Supabase exists."""

    name = "local"

    def __init__(self, path: Path = DEMO_FILE) -> None:
        self._path = path
        self._data = {
            "students": [],
            "attendance_logs": [],
            "backend_status": {},
            "staff_profiles": [],
            "grade_settings": [],
        }
        if path.exists():
            self._data.update(json.loads(path.read_text(encoding="utf-8")))
        if not self._data["students"]:
            for seed in SEED_STUDENTS:
                self.insert_student(seed)

    def _save(self) -> None:
        self._path.write_text(json.dumps(self._data, indent=2), encoding="utf-8")

    def get_student(self, fingerprint_id: int) -> dict | None:
        wanted = int(fingerprint_id)
        return next((s for s in self._data["students"] if s["fingerprint_id"] == wanted), None)

    def list_students(self) -> list[dict]:
        return sorted(self._data["students"], key=lambda s: s["fingerprint_id"])

    def insert_student(self, student: dict) -> dict:
        row = {
            "id": student.get("id") or f"local-{len(self._data['students']) + 1}",
            "created_at": _now_iso(),
            **student,
        }
        row["fingerprint_id"] = int(row["fingerprint_id"])
        self._data["students"] = [
            s for s in self._data["students"] if s["fingerprint_id"] != row["fingerprint_id"]
        ]
        self._data["students"].append(row)
        self._save()
        return row

    def insert_attendance(self, log: dict) -> dict:
        row = {"id": f"log-{len(self._data['attendance_logs']) + 1}", **log}
        self._data["attendance_logs"].append(row)
        self._save()
        return row

    def update_attendance(self, log_id: str, changes: dict) -> None:
        for row in self._data["attendance_logs"]:
            if row["id"] == log_id:
                row.update(changes)
        self._save()

    def latest_scan_for_student(self, student_id: str) -> dict | None:
        matches = [r for r in self._data["attendance_logs"] if r["student_id"] == student_id]
        return matches[-1] if matches else None

    def grade_settings(self, grade: str) -> dict | None:
        return next((r for r in self._data["grade_settings"] if r["grade_level"] == grade), None)

    def save_status(self, status: dict) -> None:
        self._data["backend_status"] = status
        self._save()

    def list_staff(self) -> list[dict]:
        return list(self._data.get("staff_profiles", []))

    def update_staff(self, profile_id: str, changes: dict) -> None:
        for row in self._data.get("staff_profiles", []):
            if row["id"] == profile_id:
                row.update(changes)
        self._save()

    def next_capture(self):
        return None

    def update_capture(self, capture_id: str, changes: dict) -> None:
        pass

    def prune_captures(self, older_than_minutes: int = 60) -> None:
        pass

    def create_auth_user(self, email: str, password: str, role: str, grade_level) -> dict:
        raise RuntimeError("Local demo store cannot create Supabase logins.")

    def ping(self) -> bool:
        return True

    def close(self) -> None:
        pass


def build_store(settings) -> SupabaseStore | LocalStore:
    if settings.has_database:
        return SupabaseStore(settings.supabase_url, settings.supabase_key)
    return LocalStore()
