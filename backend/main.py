"""Attendance service entrypoint.

    python main.py            # watch the USB scanner (or the keyboard simulator)
    python main.py --once 3   # log a single scan for fingerprint ID 3 and exit
    python main.py --clear 1  # drop the print saved under fingerprint ID 1
    python main.py --probe 30 # watch the scanner answer presses for 30 seconds
    python main.py --status   # print how the service is configured
"""

from __future__ import annotations

import sys
import time
from datetime import datetime

import sync as template_sync
import zkfp
from capture import CaptureDriver
from config import load_settings
from db import build_store
from notifier import Notifier
from scanner import SimulatedScanner, open_scanner
from service import handle_scan
from staff_sync import provision_pending

# Bumped with every backend change that the live rig must pick up; the tag
# rides in the heartbeat so the web pill shows which build is actually running.
BUILD = "2026-10-06a"


def describe(settings, store, scanner, notifier) -> str:
    database = (
        f"Supabase ({settings.supabase_url})"
        if store.name == "supabase"
        else "local demo file (backend/demo_data.json)"
    )
    email = (
        notifier.provider
        if notifier.provider.startswith("console")
        else f"{notifier.provider} as {settings.sender_address}"
    )
    return f"database: {database}\nemail   : {email}\nscanner : {scanner_line(settings, scanner)}"


def scanner_line(settings, scanner) -> str:
    if scanner is not None:
        return f"{getattr(scanner, 'label', 'scanner')} (mode: {settings.scanner_mode})"
    if settings.simulate_scanner:
        return f"keyboard simulator (mode: {settings.scanner_mode})"
    seen = zkfp.device_count()
    if seen < 0:
        return f"ZKFinger SDK not installed on this computer (mode: {settings.scanner_mode})"
    return f"{seen} USB scanner(s) visible to the SDK (mode: {settings.scanner_mode})"


def _reset_if_new_day(state: dict) -> None:
    today = datetime.now().date().isoformat()
    if state.get("day") != today:
        state["day"] = today
        state["scans"] = 0


def run_loop(scanner, store, notifier, settings) -> None:
    state: dict = {"day": "", "scans": 0}
    last_beat = 0.0
    last_sync = 0.0

    def beat(message: str) -> None:
        _reset_if_new_day(state)
        try:
            store.save_status(
                {
                    "connected": bool(getattr(scanner, "connected", False)),
                    "port": getattr(scanner, "label", "unknown"),
                    "last_heartbeat": datetime.now().astimezone().isoformat(),
                    "scans_today": state["scans"],
                    "message": message,
                }
            )
        except Exception as error:  # a dead DB should not stop the kiosk
            print(f"[status] Could not save heartbeat: {error}")

    driver = CaptureDriver(store, scanner)
    beat(f"{BUILD} · Rebuilding the scanner's memory")
    print(template_sync.report(template_sync.sync(store, scanner), scanner))
    last_sync = datetime.now().timestamp()
    beat(f"{BUILD} · Listening for scans")

    while True:
        now = datetime.now().timestamp()
        if now - last_beat >= settings.heartbeat_seconds:
            last_beat = now
            beat(
                f"{BUILD} · "
                + (
                    "Capturing a fingerprint"
                    if driver.busy
                    else getattr(scanner, "message", "Listening for scans")
                )
            )
            if not driver.busy:
                provision_pending(store)
                driver.maybe_prune()

        if not driver.busy and now - last_sync >= settings.resync_seconds:
            last_sync = now
            summary = template_sync.sync(store, scanner)
            if summary["loaded"] or summary["removed"] or summary["errors"]:
                print(template_sync.report(summary, scanner))

        template = scanner.next_scan(0.4)
        if template is None:
            driver.check_timeout()
            driver.poll_if_idle()
            continue

        if SimulatedScanner.is_quit(template):
            beat("Service stopped")
            return

        # While an enrollment is running its prints are stages, not scans.
        if driver.busy:
            driver.handle_template(template)
            continue

        try:
            found = scanner.identify(template)
        except Exception as error:
            print(f"[scan] The scanner could not match that print: {error}")
            continue

        if found is None:
            print("[scan] Print not recognised — enrol it on the Students page first.")
            continue

        result = handle_scan(store, notifier, settings, found.fid)
        if result.kind == "logged":
            _reset_if_new_day(state)
            state["scans"] += 1


def main(argv: list[str]) -> int:
    settings = load_settings()
    store = build_store(settings)
    notifier = Notifier(settings)

    if "--status" in argv:
        print(describe(settings, store, None, notifier))
        return 0

    if "--once" in argv:
        index = argv.index("--once") + 1
        if index >= len(argv) or not argv[index].isdigit():
            print("usage: python main.py --once <fingerprint_id>")
            return 2
        handle_scan(store, notifier, settings, int(argv[index]))
        return 0

    if "--probe" in argv:
        index = argv.index("--probe") + 1
        seconds = int(argv[index]) if index < len(argv) and argv[index].isdigit() else 30
        return probe(settings, min(seconds, 300))

    scanner = open_scanner(settings)
    try:
        if "--clear" in argv:
            return _clear(argv, scanner, store)

        print("Smart Attendance backend")
        print(f"build {BUILD}")
        print(describe(settings, store, scanner, notifier))
        run_loop(scanner, store, notifier, settings)
    finally:
        scanner.stop()
        store.close()
    return 0


def probe(settings, seconds: int) -> int:
    """Watches the scanner answer presses, so a panel that never speaks is obvious."""
    try:
        zk = zkfp.ZKFinger()
        zk.open(settings.scanner_index, settings.match_threshold or None)
    except zkfp.ScannerError as error:
        print(f"[probe] {error}")
        return 1
    print(f"[probe] Scanner open. Press your finger on it 3 times now; listening for {seconds}s.")
    scans: list[bytes] = []
    codes: dict[int, int] = {}
    deadline = time.time() + seconds
    while time.time() < deadline and len(scans) < 3:
        code, template = zk.capture()
        codes[code] = codes.get(code, 0) + 1
        if code == zkfp.ERR_OK and template:
            scans.append(template)
            print(f"[probe] scan {len(scans)} taken ({len(template)} bytes)")
        time.sleep(0.2)
    summary = ", ".join(f"{count}x {zkfp.error_text(code)}" for code, count in sorted(codes.items()))
    if not scans:
        print(f"[probe] Nothing usable came from the glass. Answers: {summary}")
        print("[probe] If you did press while it listened, the capture layer is not reading this model.")
        zk.close()
        return 1
    print(f"[probe] {len(scans)} scan(s): {summary}")
    if len(scans) == 3:
        print(
            "[probe] 1:1 between the presses: "
            f"{zk.match(scans[0], scans[1])} and {zk.match(scans[1], scans[2])} (positive = same finger)"
        )
        merged = zk.merge(scans)
        print(f"[probe] merged into one {len(merged)}-byte template. The scanner path works.")
    zk.close()
    return 0


def _clear(argv: list[str], scanner, store) -> int:
    index = argv.index("--clear") + 1
    if index >= len(argv) or not argv[index].isdigit():
        print("usage: python main.py --clear <fingerprint_id>")
        return 2
    fid = int(argv[index])
    template_sync.forget(fid)
    try:
        scanner.remove(fid)
    except Exception as error:
        print(f"[clear] The scanner refused to drop ID {fid}: {error}")
    cleared = store.clear_template(fid)
    print(
        f"[clear] Fingerprint ID {fid} removed from the scanner"
        + (f" and from {cleared} student row(s)." if cleared else " (no student row held it).")
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
