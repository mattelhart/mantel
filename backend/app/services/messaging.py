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
