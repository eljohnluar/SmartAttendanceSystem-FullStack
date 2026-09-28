"""Serial transport to the Arduino, plus a keyboard-driven stand-in.

Wire protocol (one line per message, newline terminated):
    device -> host : BOOT | SCAN_READY | FOUND_ID:<n> | NOT_FOUND | ENROLLED:<n> | ERROR:<msg>
    host -> device : E (capture a finger) | P (ping)
"""

from __future__ import annotations

import queue
import sys
import threading
import time
from typing import Protocol


class Link(Protocol):
    def read_line(self) -> str | None: ...
    def send(self, command: str) -> None: ...
    def close(self) -> None: ...


class SerialLink:
    """Reads the Arduino over a COM port, reconnecting if the device drops out."""

    def __init__(self, port: str, baud: int) -> None:
        import serial

        self._serial = serial.Serial(port, baud, timeout=1)
        self.port = port

    def read_line(self) -> str | None:
        raw = self._serial.readline()
        if not raw:
            return None
        return raw.decode(errors="ignore").strip()

    def send(self, command: str) -> None:
        self._serial.write(f"{command}\n".encode())
        self._serial.flush()

    def close(self) -> None:
        self._serial.close()


class SimulatedLink:
    """Types scans from the keyboard so the pipeline runs with no hardware."""

    port = "simulated"

    def __init__(self) -> None:
        self._inbox: queue.Queue[str | None] = queue.Queue()
        self._running = True
        threading.Thread(target=self._pump_stdin, daemon=True).start()
        print(
            "[simulator] No Arduino connected. Type a fingerprint ID to fake a scan, "
            "'e <id>' to enrol, 'r' to list IDs, 'q' to quit."
        )

    def _pump_stdin(self) -> None:
        for line in sys.stdin:
            self._inbox.put(line.strip())
        self._inbox.put(None)

    def read_line(self) -> str | None:
        try:
            command = self._inbox.get(timeout=0.5)
        except queue.Empty:
            return None
        if command is None:
            return "QUIT"
        command = command.lower()
        if command in {"q", "quit"}:
            return "QUIT"
        if command == "r":
            print("[simulator] Known IDs: 1, 2, 3 (see backend/demo_data.json)")
            return None
        if command.startswith("e"):
            rest = command[1:].strip()
            return f"ENROLLED:{int(rest)}" if rest.isdigit() else "ENROLLED:0"
        if command == "x":
            return "NOT_FOUND"
        return f"FOUND_ID:{int(command)}" if command.isdigit() else None

    def send(self, command: str) -> None:
        print(f"[simulator] >> {command}")

    def close(self) -> None:
        self._running = False


def open_link(settings) -> Link:
    if not settings.has_serial:
        return SimulatedLink()
    try:
        return SerialLink(settings.arduino_port, settings.baud)
    except Exception as exc:  # port vanished, wrong name, or Arduino IDE holding it
        print(f"[serial] Could not open {settings.arduino_port}: {exc}")
        print("[serial] Falling back to the keyboard simulator.")
        time.sleep(0.2)
        return SimulatedLink()
