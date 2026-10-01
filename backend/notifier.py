"""Parent notifications.

Provider is chosen by which credentials exist:
    Brevo   ~300 emails/day free, no domain verification  -> BREVO_API_KEY
    Resend  ~100/day free, needs a verified sending domain -> RESEND_API_KEY
    Gmail   SMTP with an app password, ~50/day on a free account
    Console prints the email when nothing is configured
    off     Explicitly disabled — no emails sent, nothing printed
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from email.utils import formataddr

import httpx

BREVO_URL = "https://api.brevo.com/v3/smtp/email"
RESEND_URL = "https://api.resend.com/emails"
TIMEOUT = httpx.Timeout(15.0, connect=8.0)


class Message:
    def __init__(self, to_email: str, to_name: str, subject: str, text: str, html: str) -> None:
        self.to_email = to_email
        self.to_name = to_name
        self.subject = subject
        self.text = text
        self.html = html


class ConsoleSender:
    provider = "console (nothing configured)"

    def send(self, message: Message) -> bool:
        print(f"[email] To {message.to_email} | {message.subject}\n{message.text}\n")
        return False


class BrevoSender:
    provider = "Brevo API"

    def __init__(self, api_key: str, sender_name: str, sender_address: str) -> None:
        self._key = api_key
        self._sender = {"name": sender_name, "email": sender_address}

    def send(self, message: Message) -> bool:
        try:
            response = httpx.post(
                BREVO_URL,
                headers={"api-key": self._key, "accept": "application/json"},
                json={
                    "sender": self._sender,
                    "to": [{"email": message.to_email, "name": message.to_name}],
                    "subject": message.subject,
                    "htmlContent": message.html,
                    "textContent": message.text,
                },
                timeout=TIMEOUT,
            )
            response.raise_for_status()
        except Exception as error:  # one bad send must not stop the kiosk
            print(f"[email] Brevo rejected the message: {error}")
            return False
        return True


class ResendSender:
    provider = "Resend API"

    def __init__(self, api_key: str, sender_name: str, sender_address: str) -> None:
        self._key = api_key
        self._sender = f"{sender_name} <{sender_address}>"

    def send(self, message: Message) -> bool:
        try:
            response = httpx.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {self._key}"},
                json={
                    "from": self._sender,
                    "to": [message.to_email],
                    "subject": message.subject,
                    "title": message.subject,
                    "html": message.html,
                    "text": message.text,
                },
                timeout=TIMEOUT,
            )
            response.raise_for_status()
        except Exception as error:
            print(f"[email] Resend rejected the message: {error}")
            return False
        return True


class SmtpSender:
    provider = "Gmail SMTP"

    def __init__(self, settings) -> None:
        self._settings = settings

    def send(self, message: Message) -> bool:
        settings = self._settings
        email = EmailMessage()
        email["From"] = formataddr((settings.email_sender_name, settings.sender_address))
        email["To"] = formataddr((message.to_name, message.to_email))
        email["Subject"] = message.subject
        email.set_content(message.text)
        email.add_alternative(message.html, subtype="html")

        try:
            if settings.smtp_port == 465:
                with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                    smtp.login(settings.gmail_address, settings.gmail_app_password)
                    smtp.send_message(email)
            else:
                with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
                    smtp.starttls()
                    smtp.login(settings.gmail_address, settings.gmail_app_password)
                    smtp.send_message(email)
        except Exception as error:
            print(f"[email] SMTP failure: {error}")
            return False
        return True


def build_sender(settings):
    forced = settings.email_provider
    if forced == "off":
        # Explicitly disabled — return console sender so nothing real is sent
        return ConsoleSender()
    if forced == "brevo" or (forced == "auto" and settings.brevo_api_key):
        return BrevoSender(settings.brevo_api_key, settings.email_sender_name, settings.sender_address)
    if forced == "resend" or (forced == "auto" and settings.resend_api_key):
        return ResendSender(settings.resend_api_key, settings.email_sender_name, settings.sender_address)
    if forced in {"smtp", "gmail"} or (forced == "auto" and settings.has_email):
        return SmtpSender(settings)
    return ConsoleSender()


class Notifier:
    def __init__(self, settings) -> None:
        self._settings = settings
        self._sender = build_sender(settings)
        self.sent_count = 0

    @property
    def provider(self) -> str:
        return self._sender.provider

    def notify_arrival(self, student: dict, scan_time_local, status: str) -> bool:
        """Notify parent when a student's fingerprint is scanned at the kiosk."""
        name = f"{student['first_name']} {student['last_name']}".strip()
        arrived_at = scan_time_local.strftime("%I:%M %p").lstrip("0")
        grade = student.get("grade_level", "")
        verb = "arrived late at" if status == "Late" else "arrived at"

        subject = f"{name} arrived at school ({status.lower()})"
        text = (
            f"Dear Parent/Guardian,\n\n"
            f"Your child {name}{f' ({grade})' if grade else ''} {verb} school at "
            f"{arrived_at} today.\n\n"
            f"Sent automatically by the school attendance system."
        )
        html = (
            '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
            'max-width:520px;margin:0 auto;padding:36px 24px;color:#14161a">'
            '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8b929b">'
            "Smart Attendance</p>"
            f'<h1 style="font-size:26px;margin:14px 0 6px;letter-spacing:-.02em">{name} '
            f'{verb} school</h1>'
            f'<p style="color:#4b5158;margin:0">Grade: {grade or "&mdash;"}</p>'
            f'<p style="color:#4b5158;margin:6px 0 22px">Time: {arrived_at}</p>'
            '<p style="display:inline-block;font-size:13px;font-weight:600;letter-spacing:.12em;'
            f'padding:8px 18px;border-radius:999px;background:{"#fbf0dd" if status == "Late" else "#e6f4ec"};'
            f'color:{"#9a5b00" if status == "Late" else "#127a43"}">{status.upper()}</p>'
            '<p style="margin-top:26px;font-size:12px;color:#8b929b">'
            "This notice was generated automatically by the school attendance system.</p></div>"
        )

        recipient = student.get("parent_email")
        if not recipient:
            print("[email] Skipped: student has no parent_email.")
            return False

        sent = self._sender.send(Message(recipient, name, subject, text, html))
        if sent:
            self.sent_count += 1
            print(f"[email] {self._sender.provider}: notified {name} -> {recipient}")
        return sent

    def notify_manual_attendance(self, student: dict, marked_at, status: str, marked_by: str = "") -> bool:
        """Notify parent when a teacher manually marks attendance from the dashboard.

        Uses wording that makes clear the record was entered by school staff
        rather than captured automatically by the fingerprint sensor.
        """
        name = f"{student['first_name']} {student['last_name']}".strip()
        time_str = marked_at.strftime("%I:%M %p").lstrip("0")
        grade = student.get("grade_level", "")

        status_verb = {
            "Present": "marked present",
            "Late": "marked late",
            "Absent": "marked absent",
        }.get(status, f"marked as {status.lower()}")

        by_line = f" by {marked_by}" if marked_by else ""
        subject = f"Attendance update for {name} — {status}"
        text = (
            f"Dear Parent/Guardian,\n\n"
            f"Your child {name}{f' ({grade})' if grade else ''} was {status_verb}"
            f"{by_line} at {time_str} today.\n\n"
            f"If you have questions, please contact the school.\n\n"
            f"Sent automatically by the school attendance system."
        )

        status_bg = {"Present": "#e6f4ec", "Late": "#fbf0dd", "Absent": "#fde8e8"}.get(status, "#f0f0f0")
        status_fg = {"Present": "#127a43", "Late": "#9a5b00", "Absent": "#b91c1c"}.get(status, "#444")
        html = (
            '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
            'max-width:520px;margin:0 auto;padding:36px 24px;color:#14161a">'
            '<p style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8b929b">'
            "Smart Attendance — Manual Record</p>"
            f'<h1 style="font-size:26px;margin:14px 0 6px;letter-spacing:-.02em">Attendance update for {name}</h1>'
            f'<p style="color:#4b5158;margin:0">Grade: {grade or "&mdash;"}</p>'
            f'<p style="color:#4b5158;margin:6px 0 4px">Time recorded: {time_str}</p>'
            f'<p style="color:#4b5158;margin:0 0 22px">Recorded{by_line} by school staff.</p>'
            f'<p style="display:inline-block;font-size:13px;font-weight:600;letter-spacing:.12em;'
            f'padding:8px 18px;border-radius:999px;background:{status_bg};color:{status_fg}">{status.upper()}</p>'
            '<p style="margin-top:26px;font-size:12px;color:#8b929b">'
            "If you believe this is an error, please contact the school directly.</p></div>"
        )

        recipient = student.get("parent_email")
        if not recipient:
            print("[email] Skipped manual notify: student has no parent_email.")
            return False

        sent = self._sender.send(Message(recipient, name, subject, text, html))
        if sent:
            self.sent_count += 1
            print(f"[email] {self._sender.provider}: manual notify for {name} -> {recipient} ({status})")
        return sent
