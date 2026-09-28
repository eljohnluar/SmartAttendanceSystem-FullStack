"""Turns queued staff rows into real Supabase logins.

The browser cannot create auth users — that needs the service-role key — so the
Staff page only inserts a 'pending' row and this module finishes the job while
the backend is running.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

# Ambiguous glyphs (0/O, 1/l/I) left out so a password survives being read aloud.
ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

_warned = False


def new_password() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(12))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def provision_pending(store) -> int:
    """Provisions every pending staff row. Returns how many were touched."""
    global _warned
    if store.name != "supabase":
        return 0

    try:
        rows = store.list_staff()
    except Exception as error:
        # Almost always means schema.sql has not been re-run for staff_profiles.
        if not _warned:
            print(f"[staff] Staff list unavailable, skipping provisioning: {error}")
            _warned = True
        return 0

    _warned = False
    touched = 0
    for row in rows:
        if row.get("status") != "pending":
            continue
        touched += 1
        email = row["email"]
        password = None

        try:
            # auth_id already set means a previous run created the login but
            # died before recording it, so reuse rather than register twice.
            auth_id = row.get("auth_id")
            password = row.get("temp_password") or None
            if not auth_id:
                # An admin may set the password on the Staff page; blank means
                # generate one here.
                password = password or new_password()
                auth_id = store.create_auth_user(
                    email, password, row["role"], row.get("grade_level")
                )["id"]

            store.update_staff(
                row["id"],
                {
                    "auth_id": auth_id,
                    "status": "active",
                    "temp_password": password,
                    "error": None,
                    "updated_at": _now(),
                },
            )
            print(f"[staff] Login ready for {email} — share the password from the Staff page.")
        except Exception as error:
            print(f"[staff] Could not provision {email}: {error}")
            try:
                store.update_staff(
                    row["id"], {"status": "failed", "error": str(error)[:300], "updated_at": _now()}
                )
            except Exception as db_error:
                print(f"[staff] Could not record the failure: {db_error}")

    return touched
