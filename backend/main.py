"""Attendance service entrypoint.

    python main.py            # watch the Arduino (or the keyboard simulator)
    python main.py --once 3   # log a single scan for fingerprint ID 3 and exit
    python main.py --status   # print how the service is configured
"""

from __future__ import annotations

import sys
from datetime import datetime

from capture import CaptureDriver
from config import load_settings
from db import build_store
from notifier import Notifier
from serial_link import open_link
from service import handle_scan
from staff_sync import provision_pending


def describe(settings, store, notifier) -> str:
    database = f"Supabase ({settings.supabase_url})" if store.name == "supabase" else "local demo file (backend/demo_data.json)"
    email = (
        notifier.provider
        if notifier.provider.startswith("console")
        else f"{notifier.provider} as {settings.sender_address}"
    )
    hardware = settings.arduino_port or "keyboard simulator (set ARDUINO_PORT)"
    return f"database: {database}\nemail   : {email}\nhardware: {hardware}"


def _reset_if_new_day(state: dict) -> None:
    today = datetime.now().date().isoformat()
    if state.get("day") != today:
        state["day"] = today
        state["scans"] = 0


def run_loop(link, store, notifier, settings) -> None:
    state: dict = {"day": "", "scans": 0}
    last_beat = 0.0

    def beat(connected: bool, message: str) -> None:
        _reset_if_new_day(state)
        try:
            store.save_status(
                {
                    "connected": connected,
                    "port": getattr(link, "port", "unknown"),
                    "last_heartbeat": datetime.now().astimezone().isoformat(),
                    "scans_today": state["scans"],
                    "message": message,
                }
            )
        except Exception as error:  # a dead DB should not stop the kiosk
            print(f"[status] Could not save heartbeat: {error}")

    beat(True, "Listening for scans")
    driver = CaptureDriver(store)
    while True:
        now = datetime.now().timestamp()
        if now - last_beat >= settings.heartbeat_seconds:
            last_beat = now
            beat(True, "Capturing a fingerprint" if driver.active else "Listening for scans")
            provision_pending(store)
            driver.maybe_prune()

        line = link.read_line()
        if line == "QUIT":
            beat(False, "Service stopped")
            return

        # While a capture is running its lines are enrollment steps, not scans.
        if driver.active:
            if line:
                driver.handle_line(line)
            driver.check_timeout()
            continue

        if not line:
            driver.poll_if_idle(link)
            continue

        verb, _, value = line.partition(":")
        verb = verb.strip().upper()

        if verb == "FOUND_ID":
            if not value.strip().isdigit():
                continue
            result = handle_scan(store, notifier, settings, int(value))
            if result.kind == "logged":
                _reset_if_new_day(state)
                state["scans"] += 1
        elif verb == "ENROLLED":
            print(f"[enrol] Sensor stored print as ID {value or '(unknown)'}.")
            print("[enrol] Add the student on the Enrollment page using that Fingerprint ID.")
        elif verb == "NOT_FOUND":
            print("[scan] Print not recognised by the sensor.")
        elif verb in {"BOOT", "SCAN_READY", "OK"}:
            print(f"[sensor] {line}")


def main(argv: list[str]) -> int:
    settings = load_settings()
    store = build_store(settings)
    notifier = Notifier(settings)

    if "--status" in argv:
        print(describe(settings, store, notifier))
        return 0

    if "--once" in argv:
        index = argv.index("--once") + 1
        if index >= len(argv) or not argv[index].isdigit():
            print("usage: python main.py --once <fingerprint_id>")
            return 2
        handle_scan(store, notifier, settings, int(argv[index]))
        return 0

    print("Smart Attendance backend")
    print(describe(settings, store, notifier))
    link = open_link(settings)
    try:
        run_loop(link, store, notifier, settings)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        link.close()
        store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
