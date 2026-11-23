"""Family messaging facade: Twilio SMS/MMS or a self-hosted Signal CLI API.

The wall's send path, rate limits, stored threads and doodle attachments are the
same either way. This module picks the active provider from Settings.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import User
from . import signal_messages, twilio_messages

PROVIDERS = ("twilio", "signal")
DEFAULT_PROVIDER = "twilio"

# Re-export the helpers every router already used from the Twilio module.
TwilioError = twilio_messages.TwilioError
RateLimitError = twilio_messages.RateLimitError
MessagingError = twilio_messages.TwilioError
normalize_e164 = twilio_messages.normalize_e164
valid_e164 = twilio_messages.valid_e164
media_file = twilio_messages.media_file
user_by_phone = twilio_messages.user_by_phone
assert_unique_phone = twilio_messages.assert_unique_phone
poll_interval_seconds = twilio_messages.poll_interval_seconds


def friendly_error_message(raw: str | None, name: str | None = None) -> str | None:
    """Map provider failures to a short line kids can read.

    The raw text stays in the database and in logs for debugging.
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    lowered = text.lower()
    if "couldn't be sent as a picture" in lowered:
        return text
    if "can't get signal messages from mantel" in lowered:
        return text
    if "a message can be at most" in lowered or "type a message or add a drawing" in lowered:
        return text
    if "wait a moment and try again" in lowered:
        return text
    if "unregistered" in lowered or "isn't registered" in lowered or "not registered" in lowered:
        who = (name or "").strip() or "They"
        return f"{who} can't get Signal messages from Mantel yet. Ask a grown-up for help."
    if "phone number" in lowered:
        return "Ask a grown-up to add a phone number first."
    if "ask a grown-up to finish messages settings" in lowered:
        return text
    if "twilio or signal" in lowered or "not configured" in lowered or "in settings" in lowered:
        return "Ask a grown-up to finish Messages settings, then try again."
    if "couldn't send that" in lowered:
        return "Couldn't send that. Try again in a moment."
    return "Couldn't send that. Try again in a moment."


def provider_name(db: Session) -> str:
    raw = str(twilio_messages._setting(db, "message_provider") or DEFAULT_PROVIDER).strip().lower()
    return raw if raw in PROVIDERS else DEFAULT_PROVIDER


def configured(db: Session) -> bool:
    if provider_name(db) == "signal":
        return signal_messages.configured(db)
    return twilio_messages.configured(db)


def from_number(db: Session) -> str:
    if provider_name(db) == "signal":
        return signal_messages.load_config(db).account_number if configured(db) else ""
    cfg = twilio_messages.load_config(db)
    return cfg.from_number if cfg.configured else ""


def send_to_user(db: Session, user: User, body: str, png: str | bytes | None = None):
    if provider_name(db) == "signal":
        return signal_messages.send_to_user(db, user, body, png=png)
    return twilio_messages.send_to_user(db, user, body, png=png)


def test_send(db: Session, user: User):
    if provider_name(db) == "signal":
        return signal_messages.test_send(db, user)
    return twilio_messages.test_send(db, user)


def poll_once(db: Session | None = None) -> int:
    close = False
    if db is None:
        from ..db import SessionLocal

        db = SessionLocal()
        close = True
    try:
        if provider_name(db) == "signal":
            return signal_messages.poll_once(db)
        return twilio_messages.poll_once(db)
    finally:
        if close:
            db.close()
