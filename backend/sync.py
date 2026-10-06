"""Keeps the scanner's memory in step with the templates held in Supabase.

The Live20R forgets every print when it is unplugged or the service restarts, so
nothing is recognised until this has run. It is called once at startup and again
on a timer, which also picks up prints enrolled on another machine.
"""

from __future__ import annotations

import base64
import binascii

# Fingerprint ID -> the stored template, as last pushed into the device.
_loaded: dict[int, str] = {}


def _decode(blob: str) -> bytes | None:
    try:
        raw = base64.b64decode(blob, validate=True)
    except (binascii.Error, ValueError):
        return None
    # Anything genuinely malformed is rejected by the SDK when it is loaded, so
    # this only has to catch a value that was never base64 at all.
    return raw if len(raw) >= 4 else None


def encode(template: bytes) -> str:
    return base64.b64encode(template).decode("ascii")


def decode(blob: str) -> bytes | None:
    return _decode(blob)


def remember(fid: int, template_b64: str) -> None:
    _loaded[int(fid)] = template_b64


def forget(fid: int) -> None:
    _loaded.pop(int(fid), None)


def loaded_ids() -> set[int]:
    return set(_loaded)


def sync(store, scanner) -> dict:
    """Loads every saved print into the scanner and drops the ones gone from the roster."""
    summary = {"loaded": 0, "removed": 0, "skipped": 0, "errors": []}

    # A USB reconnect hands back an empty library, which would otherwise leave
    # this module believing every print is already loaded.
    try:
        if _loaded and scanner.count() != len(_loaded):
            _loaded.clear()
    except Exception:
        _loaded.clear()

    try:
        rows = store.roster()
    except Exception as error:
        summary["errors"].append(f"could not read the roster: {error}")
        return summary

    current: dict[int, str] = {}
    for row in rows:
        fid, blob = row.get("fingerprint_id"), row.get("fingerprint_template")
        if not isinstance(fid, int) or not blob:
            continue
        current[fid] = blob

    for fid, blob in current.items():
        if _loaded.get(fid) == blob:
            continue
        template = _decode(blob)
        if template is None:
            summary["skipped"] += 1
            summary["errors"].append(
                f"ID {fid}: the saved print looks corrupt, so it was skipped. Re-enrol that student."
            )
            continue
        try:
            scanner.discard(fid)  # nothing to drop the first time an ID is loaded
            scanner.add(fid, template)
        except Exception as error:
            summary["errors"].append(f"ID {fid}: {error}")
            continue
        _loaded[fid] = blob
        summary["loaded"] += 1

    for fid in sorted(set(_loaded) - set(current)):
        try:
            scanner.discard(fid)
        except Exception as error:
            summary["errors"].append(f"ID {fid}: {error}")
            continue
        forget(fid)
        summary["removed"] += 1

    return summary


def report(summary: dict, scanner) -> str:
    parts = [
        f"{len(loaded_ids())} print(s) ready",
        f"loaded {summary['loaded']}",
        f"removed {summary['removed']}",
    ]
    if summary["skipped"]:
        parts.append(f"{summary['skipped']} unreadable")
    text = f"[sync] {scanner.label}: " + ", ".join(parts)
    for problem in summary["errors"]:
        text += f"\n[sync] ! {problem}"
    return text
