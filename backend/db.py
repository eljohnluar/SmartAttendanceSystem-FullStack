"""Data access for Supabase (PostgREST).

Talks to PostgREST over httpx rather than supabase-py: the dependency is far
lighter and the REST calls are the same ones the client library makes.

This is the cloud half of the pairing; the scanner's own data lives in SQLite
(database.py) and worker.py mirrors one into the other when the network is up.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import httpx


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

    def roster(self) -> list[dict]:
        """The few columns the scanner needs to rebuild its memory."""
        return self._request(
            "GET",
            "students",
            params={
                "select": "id,fingerprint_id,first_name,last_name,fingerprint_template",
                "order": "fingerprint_id.asc",
            },
        ).json()

    def save_template(self, fingerprint_id: int, template_b64: str) -> int:
        """Stores an enrolled print on the student row. Returns how many rows moved."""
        return self._patched_count(
            "students", {"fingerprint_id": f"eq.{int(fingerprint_id)}"}, {"fingerprint_template": template_b64}
        )

    def clear_template(self, fingerprint_id: int) -> int:
        return self._patched_count(
            "students", {"fingerprint_id": f"eq.{int(fingerprint_id)}"}, {"fingerprint_template": None}
        )

    def _patched_count(self, table: str, filters: dict, changes: dict) -> int:
        response = self._request(
            "PATCH", table, params=filters, json=changes, headers={"Prefer": "return=representation"}
        )
        return len(response.json() or [])

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

    def list_grade_settings(self) -> list[dict]:
        return self._request("GET", "grade_settings", params={"select": "*"}).json()

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
