"""Environment-driven settings for the attendance backend."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _get(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _get_int(name: str, default: int) -> int:
    raw = _get(name)
    return int(raw) if raw.isdigit() else default


def _get_choice(name: str, default: str, allowed: set[str]) -> str:
    raw = _get(name, default).lower()
    return raw if raw in allowed else default


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_key: str
    scanner_index: int
    match_threshold: int
    scanner_mode: str
    gmail_address: str
    gmail_app_password: str
    smtp_host: str
    smtp_port: int
    email_provider: str
    email_sender_name: str
    email_sender_address: str
    brevo_api_key: str
    resend_api_key: str
    duplicate_scan_minutes: int
    heartbeat_seconds: int
    resync_seconds: int
    from_override: str

    @property
    def has_database(self) -> bool:
        return bool(self.supabase_url and self.supabase_key)

    @property
    def has_email(self) -> bool:
        return bool(self.gmail_address and self.gmail_app_password)

    @property
    def simulate_scanner(self) -> bool:
        return self.scanner_mode == "simulate"

    @property
    def allow_simulator_fallback(self) -> bool:
        """'usb' demands the real device; 'auto' lets a missing one drop to keys."""
        return self.scanner_mode == "auto"

    @property
    def sender_address(self) -> str:
        return self.email_sender_address or self.from_override or self.gmail_address


def load_settings() -> Settings:
    return Settings(
        supabase_url=_get("SUPABASE_URL").rstrip("/"),
        supabase_key=_get("SUPABASE_SERVICE_ROLE_KEY"),
        scanner_index=_get_int("SCANNER_INDEX", 0),
        match_threshold=_get_int("SCANNER_MATCH_THRESHOLD", 0),
        scanner_mode=_get_choice("SCANNER_MODE", "auto", {"auto", "usb", "simulate"}),
        gmail_address=_get("GMAIL_ADDRESS"),
        gmail_app_password=_get("GMAIL_APP_PASSWORD").replace(" ", ""),
        smtp_host=_get("SMTP_HOST", "smtp.gmail.com"),
        smtp_port=_get_int("SMTP_PORT", 465),
        email_provider=_get("EMAIL_PROVIDER", "auto").lower(),
        email_sender_name=_get("EMAIL_SENDER_NAME", "School Attendance"),
        email_sender_address=_get("EMAIL_SENDER_ADDRESS"),
        brevo_api_key=_get("BREVO_API_KEY"),
        resend_api_key=_get("RESEND_API_KEY"),
        duplicate_scan_minutes=_get_int("DUPLICATE_SCAN_MINUTES", 45),
        heartbeat_seconds=_get_int("HEARTBEAT_SECONDS", 5),
        resync_seconds=_get_int("TEMPLATE_RESYNC_SECONDS", 60),
        from_override=_get("EMAIL_FROM_OVERRIDE"),
    )
