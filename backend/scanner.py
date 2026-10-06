"""The USB fingerprint scanner behind one interface, plus a keyboard stand-in.

The Live20R keeps no templates of its own: every print is captured here, turned
into a template by the SDK, and matched against a library the backend holds in
memory (and rebuilds from Supabase on startup).

Threading follows the vendor demo: a capture thread owns the device handle and
only ever calls AcquireFingerprint, while the service thread owns the template
library and does every identify/merge/add against it.
"""

from __future__ import annotations

import queue
import sys
import threading
import time
from dataclasses import dataclass

import zkfp


@dataclass(frozen=True)
class Match:
    fid: int
    score: int


class Scanner:
    """Interface shared by the real device and the simulator."""

    label = "scanner"
    connected = False
    message = ""

    def start(self) -> None: ...
    def stop(self) -> None: ...
    def next_scan(self, timeout: float) -> bytes | None: ...
    def identify(self, template: bytes) -> Match | None: ...
    def add(self, fid: int, template: bytes) -> None: ...
    def remove(self, fid: int) -> None: ...
    def merge(self, templates: list[bytes]) -> bytes: ...
    def same_finger(self, previous: bytes, current: bytes) -> bool: ...
    def count(self) -> int: ...

    def discard(self, fid: int) -> None:
        """Remove when it is there, shrug when it is not."""
        try:
            self.remove(fid)
        except Exception:
            pass


class LiveScanner(Scanner):
    """ZKTeco Live20R driven through the ZKFinger SDK."""

    RECONNECT_SECONDS = 3
    RETRY_SLEEP = 0.1
    IDLE_SLEEP = 0.25
    # An untouched panel answers straight away, so this is just how often to ask
    # the SDK whether the cable is still in.
    IDLE_PROBE_AFTER = 16

    def __init__(self, device_index: int = 0, threshold: int | None = None) -> None:
        self.device_index = device_index
        self.threshold = threshold
        self.label = f"Live20R #{device_index}"
        self._zk: zkfp.ZKFinger | None = None
        self._events: queue.Queue[tuple[str, object]] = queue.Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._idle = 0
        self._next_try = 0.0
        self.connected = False
        self.message = "Starting"

    # ── lifecycle ────────────────────────────────────────────────────────
    def start(self) -> None:
        self._open()
        self._thread = threading.Thread(target=self._pump, name="fingerprint-capture", daemon=True)
        self._thread.start()

    def _open(self) -> bool:
        if self._zk is not None:
            return True
        if time.time() < self._next_try:
            return False
        try:
            zk = zkfp.ZKFinger()
            zk.open(self.device_index, self.threshold)
        except zkfp.ScannerError as error:
            self._next_try = time.time() + self.RECONNECT_SECONDS
            self.connected = False
            self.message = str(error)
            return False
        self._zk = zk
        self._idle = 0
        self.connected = True
        self.message = "Listening for a finger"
        return True

    def stop(self) -> None:
        self._stop.set()
        if self._zk is not None:
            self._zk.close()
            self._zk = None
        self.connected = False

    # ── capture thread ───────────────────────────────────────────────────
    def _pump(self) -> None:
        while not self._stop.is_set():
            if self._zk is None:
                if not self._open():
                    self._stop.wait(0.3)
                    continue
            try:
                code, template = self._zk.capture()
            except Exception as error:  # a yanked cable surfaces as an OSError
                self._drop(f"The scanner stopped answering: {error}")
                continue

            if code == zkfp.ERR_OK and template is not None:
                self._idle = 0
                if not self.connected:
                    self.connected = True
                    self.message = "Listening for a finger"
                self._events.put(("scan", template))
                self._stop.wait(self.RETRY_SLEEP)
            elif code in zkfp.NOT_PRESSED:
                self._wait_when_idle()
            elif code in zkfp.DEVICE_GONE:
                self._drop(zkfp.error_text(code))
            else:
                # A print too dry, dirty or hastily pressed to read. The next
                # press is a fresh chance, so say nothing and keep listening.
                self._stop.wait(self.RETRY_SLEEP)

    def _wait_when_idle(self) -> None:
        """Paces the empty-panel loop and notices an unplugged scanner."""
        self._idle += 1
        if self._idle >= self.IDLE_PROBE_AFTER:
            self._idle = 0
            if self._zk is not None and not self._zk.device_present(self.device_index):
                self._drop("No scanner is plugged in")
                return
        self._stop.wait(self.IDLE_SLEEP)

    def _drop(self, reason: str) -> None:
        self._idle = 0
        if self._zk is not None:
            try:
                self._zk.close()
            except Exception:
                pass
            self._zk = None
        self.connected = False
        self.message = f"{reason} - waiting for the scanner to come back."
        self._next_try = time.time() + self.RECONNECT_SECONDS
        self._events.put(("note", self.message))

    # ── service-thread API ───────────────────────────────────────────────
    def next_scan(self, timeout: float) -> bytes | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                kind, payload = self._events.get(timeout=min(0.2, max(0.01, deadline - time.time())))
            except queue.Empty:
                return None
            if kind == "scan":
                return payload  # type: ignore[return-value]
            if kind == "note":
                print(f"[scanner] {payload}")
        return None

    def _library(self) -> zkfp.ZKFinger:
        if self._zk is None or self._zk.cache is None:
            raise zkfp.ScannerError("The scanner is not connected right now.")
        return self._zk

    def identify(self, template: bytes) -> Match | None:
        found = self._library().identify(template)
        return Match(*found) if found else None

    def add(self, fid: int, template: bytes) -> None:
        self._library().add(fid, template)

    def remove(self, fid: int) -> None:
        self._library().remove(fid)

    def merge(self, templates: list[bytes]) -> bytes:
        return self._library().merge(templates)

    def same_finger(self, previous: bytes, current: bytes) -> bool:
        return self._library().match(previous, current) > 0

    def count(self) -> int:
        return self._library().count() if self._zk else 0


class SimulatedScanner(Scanner):
    """Fingerprints typed at the keyboard, so the pipeline runs with no device.

    Type a number to present that finger, 'x' for an unenrolled finger, 'r' to
    list what is loaded. Enrolling is three presses of the same number.
    """

    prefix = b"sim:"

    def __init__(self) -> None:
        self.label = "keyboard simulator"
        self.connected = True
        self.message = "Type a fingerprint ID to fake a scan"
        self._events: queue.Queue[str | None] = queue.Queue()
        self._loaded: set[int] = set()
        self._last_id: int | None = None
        threading.Thread(target=self._pump_stdin, daemon=True).start()
        print(
            "[simulator] No USB scanner in use. Type a fingerprint ID to fake a scan, "
            "'e <id>' to present a fresh finger for enrolment, 'x' for an unknown finger, "
            "'r' to list loaded IDs, 'q' to quit."
        )

    def _pump_stdin(self) -> None:
        for line in sys.stdin:
            self._events.put(line.strip())
        self._events.put(None)

    def _token(self, fid: int) -> bytes:
        self._last_id = fid
        return self.prefix + str(fid).encode()

    def start(self) -> None: ...

    def stop(self) -> None: ...

    def next_scan(self, timeout: float) -> bytes | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                line = self._events.get(timeout=min(0.2, max(0.01, deadline - time.time())))
            except queue.Empty:
                continue
            if line is None:
                self.connected = False
                return self.prefix + b"QUIT"
            command = line.lower().strip()
            if command in {"q", "quit"}:
                self.connected = False
                return self.prefix + b"QUIT"
            if command == "r":
                print(f"[simulator] Loaded IDs: {sorted(self._loaded) or 'none'}")
                continue
            if command == "x":
                return self._token(9999)
            if command.startswith("e"):
                rest = command[1:].strip()
                if rest.isdigit():
                    return self._token(int(rest))
                if self._last_id is not None:
                    return self._token(self._last_id)
                print("[simulator] Give it an ID first: e 12")
                continue
            if command.isdigit():
                return self._token(int(command))
        return None

    def identify(self, template: bytes) -> Match | None:
        fid = self._fid(template)
        return Match(fid, 900) if fid in self._loaded else None

    def add(self, fid: int, template: bytes) -> None:
        self._loaded.add(int(fid))

    def remove(self, fid: int) -> None:
        self._loaded.discard(int(fid))

    def merge(self, templates: list[bytes]) -> bytes:
        return templates[0]

    def same_finger(self, previous: bytes, current: bytes) -> bool:
        return self._fid(previous) == self._fid(current)

    def count(self) -> int:
        return len(self._loaded)

    @staticmethod
    def _fid(template: bytes) -> int:
        body = template.removeprefix(SimulatedScanner.prefix).decode(errors="ignore")
        return int(body) if body.isdigit() else -1

    @staticmethod
    def is_quit(template: bytes) -> bool:
        return template == SimulatedScanner.prefix + b"QUIT"


def open_scanner(settings) -> Scanner:
    """The USB device when it answers, the keyboard simulator when it does not."""
    if settings.simulate_scanner:
        return SimulatedScanner()
    scanner = LiveScanner(settings.scanner_index, settings.match_threshold)
    try:
        scanner.start()
    except zkfp.ScannerError as error:
        if not settings.allow_simulator_fallback:
            raise
        print(f"[scanner] {error}\n[scanner] Falling back to the keyboard simulator.")
        return SimulatedScanner()
    if not scanner.connected and settings.allow_simulator_fallback:
        print(f"[scanner] {scanner.message}\n[scanner] Falling back to the keyboard simulator.")
        scanner.stop()
        return SimulatedScanner()
    return scanner
