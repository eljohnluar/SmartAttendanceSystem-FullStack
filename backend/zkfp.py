"""ctypes bindings for the ZKFinger SDK (libzkfp.dll).

Signatures follow c/libs/include/libzkfp.h from the Standard SDK 5.3, where the
device handle and the algorithm ("DB cache") handle are separate and every call
uses the __stdcall convention.
"""

from __future__ import annotations

import ctypes
import os
import sys
from ctypes import wintypes
from pathlib import Path

MAX_TEMPLATE_SIZE = 2048
DEFAULT_IMAGE_SIZE = 504 * 600  # 500 dpi optical panel, used if the SDK won't say

ERR_OK = 0
ERR_NO_DEVICE = -3
ERR_INVALID_HANDLE = -7
ERR_CAPTURE = -8
ERR_EXTRACT = -9
ERR_ABORT = -10
ERR_BUSY = -12
ERR_CANCEL = -18
ERR_TIMEOUT = -28
# An idle panel answers these straight away, which is the normal state between
# students rather than a fault.
NOT_PRESSED = (ERR_CAPTURE, ERR_ABORT, ERR_CANCEL, ERR_TIMEOUT)
# These mean the handle or the device itself has gone away.
DEVICE_GONE = (ERR_NO_DEVICE, ERR_INVALID_HANDLE)

# Parameter codes
PARAM_IMAGE_WIDTH = 1
PARAM_IMAGE_HEIGHT = 2
PARAM_11_THRESHOLD = 1
PARAM_1N_THRESHOLD = 2

_ERROR_NAMES = {
    ERR_OK: "ok",
    -1: "algorithm init failed",
    -2: "capture init failed",
    ERR_NO_DEVICE: "no device",
    -4: "not supported",
    -5: "invalid parameter",
    -6: "device open failed",
    -7: "invalid handle",
    ERR_CAPTURE: "capture failed",
    ERR_EXTRACT: "could not extract a template from that print",
    ERR_ABORT: "aborted",
    -11: "out of memory",
    ERR_BUSY: "already capturing",
    -13: "could not add the template",
    -14: "could not delete the template",
    -17: "failed",
    ERR_CANCEL: "cancelled",
    -20: "verification failed",
    -22: "could not merge the templates",
    -23: "device not open",
    -24: "not initialised",
    -25: "device already open",
    -26: "could not load the image",
    -27: "could not analyse the image",
    ERR_TIMEOUT: "timed out",
}


def error_text(code: int) -> str:
    return f"{_ERROR_NAMES.get(code, 'unknown error')} (code {code})"


class ScannerError(RuntimeError):
    """The SDK refused an operation; the message is safe to show an operator."""


def _candidate_paths() -> list[Path]:
    override = (os.getenv("ZKFP_DLL_PATH") or "").strip()
    if override:
        return [Path(override)]
    if sys.platform != "win32":
        return [Path("libzkfp.so")]
    system = Path(os.getenv("SystemRoot", r"C:\Windows"))
    # A 64-bit interpreter must load the 64-bit build, which lives in System32;
    # SysWOW64 holds the 32-bit one and fails to load here.
    bit = "System32" if sys.maxsize > 2**32 else "SysWOW64"
    return [system / bit / "libzkfp.dll", system / "SysWOW64" / "libzkfp.dll"]


def load_dll() -> ctypes.WinDLL:
    tried = []
    for path in _candidate_paths():
        tried.append(str(path))
        try:
            return ctypes.WinDLL(str(path))
        except OSError:
            continue
    raise ScannerError(
        "ZKFinger SDK not found. Install it on this machine, or point ZKFP_DLL_PATH at "
        "libzkfp.dll. Looked in: " + ", ".join(tried)
    )


_FUNCTIONS = {
    "ZKFPM_Init": (ctypes.c_int, []),
    "ZKFPM_Terminate": (ctypes.c_int, []),
    "ZKFPM_GetDeviceCount": (ctypes.c_int, []),
    "ZKFPM_OpenDevice": (wintypes.HANDLE, [ctypes.c_int]),
    "ZKFPM_CloseDevice": (ctypes.c_int, [wintypes.HANDLE]),
    "ZKFPM_SetParameters": (
        ctypes.c_int,
        [wintypes.HANDLE, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint],
    ),
    "ZKFPM_GetParameters": (
        ctypes.c_int,
        [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint)],
    ),
    "ZKFPM_AcquireFingerprint": (
        ctypes.c_int,
        [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint)],
    ),
    "ZKFPM_DBInit": (wintypes.HANDLE, []),
    "ZKFPM_DBFree": (ctypes.c_int, [wintypes.HANDLE]),
    "ZKFPM_DBSetParameter": (ctypes.c_int, [wintypes.HANDLE, ctypes.c_int, ctypes.c_int]),
    "ZKFPM_DBAdd": (ctypes.c_int, [wintypes.HANDLE, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint]),
    "ZKFPM_DBDel": (ctypes.c_int, [wintypes.HANDLE, ctypes.c_uint]),
    "ZKFPM_DBClear": (ctypes.c_int, [wintypes.HANDLE]),
    "ZKFPM_DBCount": (ctypes.c_int, [wintypes.HANDLE, ctypes.POINTER(ctypes.c_uint)]),
    "ZKFPM_DBIdentify": (
        ctypes.c_int,
        [
            wintypes.HANDLE,
            ctypes.c_void_p,
            ctypes.c_uint,
            ctypes.POINTER(ctypes.c_uint),
            ctypes.POINTER(ctypes.c_uint),
        ],
    ),
    "ZKFPM_DBMatch": (
        ctypes.c_int,
        [wintypes.HANDLE, ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_uint],
    ),
    "ZKFPM_DBMerge": (
        ctypes.c_int,
        [
            wintypes.HANDLE,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint),
        ],
    ),
}


def device_count() -> int:
    """Scanners the SDK can see; 0 means none, -1 means the SDK is missing."""
    try:
        dll = load_dll()
    except ScannerError:
        return -1
    for name in ("ZKFPM_Init", "ZKFPM_GetDeviceCount", "ZKFPM_Terminate"):
        getattr(dll, name).restype = ctypes.c_int
    if dll.ZKFPM_Init() not in (ERR_OK, 1):
        return 0
    try:
        return max(int(dll.ZKFPM_GetDeviceCount()), 0)
    finally:
        dll.ZKFPM_Terminate()


def _buffer(size: int) -> ctypes.Array:
    return ctypes.create_string_buffer(size)


class ZKFinger:
    """One open scanner plus the in-memory template library it matches against."""

    def __init__(self, dll: ctypes.WinDLL | None = None) -> None:
        self._dll = dll or load_dll()
        for name, (restype, argtypes) in _FUNCTIONS.items():
            fn = getattr(self._dll, name)
            fn.restype = restype
            fn.argtypes = argtypes
        self.device: int | None = None
        self.cache: int | None = None
        self.image_size = DEFAULT_IMAGE_SIZE
        self.initialised = False

    # ── lifecycle ────────────────────────────────────────────────────────
    def _call(self, name: str, *args):
        return getattr(self._dll, name)(*args)

    def open(self, device_index: int = 0, threshold: int | None = None) -> None:
        if self.initialised:
            return
        if self._call("ZKFPM_Init") not in (ERR_OK, 1):
            raise ScannerError("Could not initialise the ZKFinger SDK.")
        self.initialised = True
        try:
            count = self._call("ZKFPM_GetDeviceCount")
            if count <= device_index:
                raise ScannerError(
                    f"No scanner found ({count} device{'s' if count != 1 else ''} on this computer)."
                )
            handle = self._call("ZKFPM_OpenDevice", device_index)
            if not handle:
                raise ScannerError("The scanner is present but refused to open.")
            self.device = handle
            self.image_size = self._image_size()
            self.cache = self._call("ZKFPM_DBInit")
            if not self.cache:
                raise ScannerError("Could not create the template library.")
            if threshold:
                self._check(
                    "ZKFPM_DBSetParameter",
                    self.cache,
                    PARAM_1N_THRESHOLD,
                    int(threshold),
                    message="Could not set the match threshold.",
                )
        except Exception:
            self.close()
            raise

    def close(self) -> None:
        if self.cache:
            self._call("ZKFPM_DBFree", self.cache)
            self.cache = None
        if self.device:
            self._call("ZKFPM_CloseDevice", self.device)
            self.device = None
        if self.initialised:
            self._call("ZKFPM_Terminate")
            self.initialised = False

    def _image_size(self) -> int:
        width, height = ctypes.c_uint(0), ctypes.c_uint(0)
        size = ctypes.c_uint(4)
        ok_w = self._call("ZKFPM_GetParameters", self.device, PARAM_IMAGE_WIDTH,
                          ctypes.byref(width), ctypes.byref(size))
        size.value = 4
        ok_h = self._call("ZKFPM_GetParameters", self.device, PARAM_IMAGE_HEIGHT,
                          ctypes.byref(height), ctypes.byref(size))
        if ok_w == ERR_OK and ok_h == ERR_OK and width.value and height.value:
            return int(width.value) * int(height.value)
        return DEFAULT_IMAGE_SIZE

    # ── capture ──────────────────────────────────────────────────────────
    def capture(self) -> tuple[int, bytes | None]:
        """Waits for a finger and returns (code, template).

        code is ERR_OK with a template, ERR_EXTRACT for a print too poor to use,
        or one of NOT_PRESSED when nobody touched the glass.
        """
        if not self.device:
            raise ScannerError("The scanner is not open.")
        image = _buffer(self.image_size)
        template = _buffer(MAX_TEMPLATE_SIZE)
        length = ctypes.c_uint(MAX_TEMPLATE_SIZE)
        code = self._call(
            "ZKFPM_AcquireFingerprint",
            self.device,
            image,
            self.image_size,
            template,
            ctypes.byref(length),
        )
        if code != ERR_OK:
            return code, None
        if not 8 <= length.value <= MAX_TEMPLATE_SIZE:
            return ERR_EXTRACT, None
        return ERR_OK, template.raw[: length.value]

    # ── template library ─────────────────────────────────────────────────
    def device_present(self, index: int = 0) -> bool:
        """Asks the SDK rather than guessing from a failed capture."""
        try:
            return self._call("ZKFPM_GetDeviceCount") > index
        except Exception:
            return False

    def add(self, fid: int, template: bytes) -> None:
        self._check(
            "ZKFPM_DBAdd",
            self.cache,
            int(fid),
            template,
            len(template),
            message=f"Could not load fingerprint ID {fid} into the scanner.",
        )

    def remove(self, fid: int) -> None:
        self._check("ZKFPM_DBDel", self.cache, int(fid), message=f"Could not remove fingerprint ID {fid}.")

    def clear(self) -> None:
        self._check("ZKFPM_DBClear", self.cache, message="Could not empty the template library.")

    def count(self) -> int:
        total = ctypes.c_uint(0)
        self._check("ZKFPM_DBCount", self.cache, ctypes.byref(total), message="Could not count templates.")
        return int(total.value)

    def identify(self, template: bytes) -> tuple[int, int] | None:
        """Returns (fingerprint id, score) when the print beats the threshold."""
        fid, score = ctypes.c_uint(0), ctypes.c_uint(0)
        code = self._call("ZKFPM_DBIdentify", self.cache, template, len(template),
                          ctypes.byref(fid), ctypes.byref(score))
        if code == ERR_OK:
            return int(fid.value), int(score.value)
        return None

    def match(self, first: bytes, second: bytes) -> int:
        """1:1 score between two raw captures; <=0 means different fingers."""
        return int(self._call("ZKFPM_DBMatch", self.cache, first, len(first), second, len(second)))

    def merge(self, templates: list[bytes]) -> bytes:
        """Fold up to three captures of the same finger into one enrolled template."""
        padded = list(templates) + [templates[-1]] * (3 - len(templates))
        out = _buffer(MAX_TEMPLATE_SIZE)
        length = ctypes.c_uint(MAX_TEMPLATE_SIZE)
        self._check(
            "ZKFPM_DBMerge",
            self.cache,
            padded[0],
            padded[1],
            padded[2],
            out,
            ctypes.byref(length),
            message="Could not merge those scans into one print.",
        )
        if not 8 <= length.value <= MAX_TEMPLATE_SIZE:
            raise ScannerError("The merged print came back unusable. Please try again.")
        return out.raw[: length.value]

    def _check(self, name: str, *args, message: str) -> int:
        code = self._call(name, *args)
        if code != ERR_OK:
            raise ScannerError(f"{message}: {error_text(code)}")
        return code
