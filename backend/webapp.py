"""Serves the built web app, so one machine can run the whole system.

The browser talks to Supabase on its own with the anon key that was baked into
the build during `npm run build`, so all this has to do is hand out the static
files in frontend/dist. It binds to the loopback address on purpose: the folder
is the entire app, and a copy reachable from the LAN would let anyone on the
network load it and watch the class.

Hash routing (`#/roster`) lives entirely in the browser, so no rewrite rules are
needed — every path serves index.html's own file, and unknown ones 404.
"""

from __future__ import annotations

import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from os import getenv
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_PORT = 8766


def _find_dist() -> Path:
    """The built app, in whichever layout this machine is using.

    In the repository it sits beside the backend; once installed it is a `web`
    folder next to it. WEB_DIST overrides both for a non-standard location.
    """
    override = (getenv("WEB_DIST") or "").strip()
    if override:
        return Path(override)
    for candidate in (BASE_DIR.parent / "frontend" / "dist", BASE_DIR.parent / "web"):
        if (candidate / "index.html").exists():
            return candidate
    return BASE_DIR.parent / "frontend" / "dist"


class _QuietHandler(SimpleHTTPRequestHandler):
    """Keeps the scanner console clear of one line per favicon request."""

    def log_message(self, *_args) -> None:
        return


def missing_build(directory: Path | None = None) -> bool:
    return not ((directory or _find_dist()) / "index.html").exists()


def serve(port: int = DEFAULT_PORT, directory: Path | None = None) -> ThreadingHTTPServer:
    handler = partial(_QuietHandler, directory=str(directory or _find_dist()))
    # Threading, because a page that pulls its own bundle plus a long-lived
    # realtime socket must not starve the next visitor.
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def start(settings, open_browser: bool = False) -> str | None:
    """Starts the server unless the build is absent. Returns its address."""
    directory = _find_dist()
    if not (directory / "index.html").exists():
        print("[web] No built web app found, so no page is being served.")
        print(f"[web] Looked in {directory}. Build it with:  cd frontend && npm run build")
        return None

    port = getattr(settings, "web_port", DEFAULT_PORT)
    serve(port, directory)
    url = f"http://localhost:{port}"
    print(f"[web] Serving the app at {url} from {directory}")
    if open_browser:
        webbrowser.open(url)
    return url
