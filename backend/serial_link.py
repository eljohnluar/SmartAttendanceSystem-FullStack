"""Serial transport to the Arduino, plus a keyboard-driven stand-in.

Wire protocol (one line per message, newline terminated):
    device -> host : BOOT | SCAN_READY | FOUND_ID:<n> | NOT_FOUND | ENROLLED:<n>
                     ENROL_WAIT_1 | ENROL_SEEN_1 | ENROL_LIFT | ENROL_WAIT_2 |
                     ENROL_SEEN_2 | ERROR:<msg>
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

    RECONNECT_SECONDS = 3

    def __init__(self, port: str, baud: int) -> None:
        import serial

        self._serial_mod = serial
        self.port = port
        self.baud = baud
        self._serial = None
        self._next_try = 0.0
        self._warned = False
        self._ever_opened = False

    def _ensure_open(self) -> bool:
        if self._serial is not None and self._serial.is_open:
            return True
        if time.time() < self._next_try:
            return False
        self._next_try = time.time() + self.RECONNECT_SECONDS
        try:
            self._serial = self._serial_mod.Serial(self.port, self.baud, timeout=1)
        except Exception:
            if not self._warned:
                print(f"[serial] {self.port} not available - waiting for the Arduino to come back.")
                self._warned = True
            return False
        self._warned = False
        if self._ever_opened:
            print(f"[serial] Reconnected to {self.port}.")
        self._ever_opened = True
        return True

    def read_line(self) -> str | None:
        if not self._ensure_open():
            time.sleep(0.2)
            return None
        try:
            raw = self._serial.readline()
        except Exception as exc:  # USB yanked or the port stolen mid-read
            print(f"[serial] Link dropped ({exc}); will retry.")
            self._serial = None
            return None
        if not raw:
            return None
        return raw.decode(errors="ignore").strip()

    def send(self, command: str) -> None:
        if not self._ensure_open():
            return
        try:
            self._serial.write(f"{command}\n".encode())
            self._serial.flush()
        except Exception as exc:
            print(f"[serial] Send failed ({exc}); will retry.")
            self._serial = None

    def close(self) -> None:
        if self._serial is not None:
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
            "'e <id>' to enrol, 'd <id>' to clear a slot, 'r' to list IDs, 'q' to quit."
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
        if command.startswith("d"):
            rest = command[1:].strip()
            return f"DELETED:{int(rest)}" if rest.isdigit() else "DELETED:0"
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
    # Open lazily and keep retrying: a briefly-busy or unplugged port must not
    # strand the service on the simulator (which exits when stdin is empty).
    return SerialLink(settings.arduino_port, settings.baud)
