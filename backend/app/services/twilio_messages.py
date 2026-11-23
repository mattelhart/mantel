"""Two-way family SMS/MMS through Twilio, without opening the Mantel server.

Outbound text uses the Messages API. Pictures cannot use a MediaUrl on this
machine: the server is LAN-only, and Twilio has to fetch that URL itself.
The workaround is to upload the PNG to Twilio first, then hand Twilio back a
URL it already hosts:

1. A Conversations / Chat service is created once (FriendlyName "Mantel media")
   and its SID is remembered in app_settings (not a secret).
2. The PNG is POSTed to Twilio's Media Content Service (MCS). MCS returns a
   short-lived `content_direct_temporary` URL on Twilio's CDN.
3. That URL is passed as MediaUrl on the Messages API call immediately. Twilio
   copies the bytes into the Message's own Media resource; the temporary URL
   can then expire.

Trade-off: the temporary CDN link is briefly fetchable by anyone who has it
(typically minutes). It is not served from Mantel, no inbound ports are
opened, and the wall never has to be reachable from the internet. If the
upload fails, the text is still sent, with a short note that the picture
could not be attached.

Inbound replies are not delivered by webhook (that would need a public URL).
A background loop lists Messages sent to the Twilio number every few seconds,
stores new ones, downloads inbound MMS with authenticated Twilio requests,
and relies on the existing live-notice commit hook so open screens refresh.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import re
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AppSetting, FamilyMessage, User
from .ha_home import open_token

log = logging.getLogger(__name__)

TWILIO_API = "https://api.twilio.com/2010-04-01"
CONVERSATIONS_API = "https://conversations.twilio.com/v1"
MCS_API = "https://mcs.us1.twilio.com/v1"
SERVICE_NAME = "Mantel media"
INTERNAL_KEYS = ("twilio_conversations_service_sid", "twilio_poll_since")
SECRET_KEYS = ("twilio_account_sid", "twilio_auth_token")
MAX_BODY = 1000
MAX_MEDIA_BYTES = 5 * 1024 * 1024
MAX_SENDS_PER_MINUTE = 20
REQUEST_TIMEOUT = 20.0
PENDING_STATUSES = frozenset({"queued", "accepted", "scheduled", "sending", "sent"})
TERMINAL_STATUSES = frozenset({"delivered", "undelivered", "failed", "canceled", "received"})

# Tests replace this.
_sends: deque[float] = deque()
_sends_lock = threading.Lock()


class TwilioError(Exception):
    """Safe to show the user. Never includes credentials."""


class RateLimitError(TwilioError):
    pass


@dataclass(frozen=True)
class TwilioConfig:
    account_sid: str
    auth_token: str
    from_number: str
    service_sid: str
    poll_since: str

    @property
    def configured(self) -> bool:
        return bool(self.account_sid and self.auth_token and self.from_number)

    @property
    def auth(self) -> tuple[str, str]:
        return (self.account_sid, self.auth_token)


def poll_interval_seconds() -> float:
    raw = os.environ.get("TWILIO_POLL_SECONDS", "7")
    try:
        return max(2.0, float(raw))
    except ValueError:
        return 7.0


def reset_rate_limiter() -> None:
    with _sends_lock:
        _sends.clear()


def build_client() -> httpx.Client:
    return httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True)


def normalize_e164(raw: str) -> str:
    """Turn typed numbers into E.164. 10-digit US numbers get a +1."""
    text = (raw or "").strip()
    if not text:
        return ""
    compact = re.sub(r"[^\d+]", "", text)
    if compact.startswith("+"):
        digits = re.sub(r"\D", "", compact)
        return f"+{digits}" if digits else ""
    digits = re.sub(r"\D", "", compact)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}" if digits else ""


def valid_e164(number: str) -> bool:
    return bool(re.fullmatch(r"\+[1-9]\d{7,14}", number or ""))


def data_dir() -> Path:
    from ..config import get_settings

    url = get_settings().database_url
    if url.startswith("sqlite"):
        db_path = url.split("///", 1)[-1]
        base = Path(db_path).parent if db_path and db_path != ":memory:" else Path("/data")
    else:
        base = Path("/data")
    return base


def media_dir() -> Path:
    target = data_dir() / "messages"
    target.mkdir(parents=True, exist_ok=True)
    return target


def media_file(name: str) -> Path:
    """Resolve a stored filename. Rejects anything that is not a bare name."""
    if not name or "/" in name or "\\" in name or name.startswith("."):
        raise TwilioError("That attachment is missing.")
    path = media_dir() / name
    if path.resolve().parent != media_dir().resolve():
        raise TwilioError("That attachment is missing.")
    return path


def _setting(db: Session, key: str) -> object:
    row = db.get(AppSetting, key)
    if row is None:
        return None
    return row.value.get("value")


def write_setting(db: Session, key: str, value: object) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value={"value": value}))
    else:
        row.value = {"value": value}


def load_config(db: Session) -> TwilioConfig:
    sid = open_token(_setting(db, "twilio_account_sid"))
    token = open_token(_setting(db, "twilio_auth_token"))
    raw_from = str(_setting(db, "twilio_from_number") or "")
    from_number = normalize_e164(raw_from) if raw_from else ""
    service_sid = str(_setting(db, "twilio_conversations_service_sid") or "")
    poll_since = str(_setting(db, "twilio_poll_since") or "")
    return TwilioConfig(
        account_sid=sid.strip(),
        auth_token=token.strip(),
        from_number=from_number,
        service_sid=service_sid.strip(),
        poll_since=poll_since.strip(),
    )


def configured(db: Session) -> bool:
    return load_config(db).configured


def mark_poll_since_now(db: Session) -> None:
    """Start listening from now so a first setup does not import old texts."""
    if not _setting(db, "twilio_poll_since"):
        write_setting(db, "twilio_poll_since", datetime.now(UTC).strftime("%Y-%m-%d"))


def _check_rate() -> None:
    now = time.monotonic()
    with _sends_lock:
        while _sends and now - _sends[0] > 60:
            _sends.popleft()
        if len(_sends) >= MAX_SENDS_PER_MINUTE:
            raise RateLimitError(
                "That's a lot of texts in one minute. Wait a moment and try again."
            )
        _sends.append(now)


def decode_png(data: str | bytes) -> bytes:
    """Accept raw bytes or a data-URL / bare base64 PNG, re-encode, cap size."""
    raw: bytes
    if isinstance(data, bytes):
        raw = data
    else:
        text = data.strip()
        if "," in text and text.lower().startswith("data:"):
            text = text.split(",", 1)[1]
        try:
            raw = base64.b64decode(text, validate=False)
        except (ValueError, TypeError) as exc:
            raise TwilioError("That drawing could not be read.") from exc
    if not raw:
        raise TwilioError("That drawing was empty.")
    if len(raw) > MAX_MEDIA_BYTES:
        raise TwilioError("That drawing is too large to send as a picture.")
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
        with Image.open(io.BytesIO(raw)) as img:
            img = img.convert("RGBA")
            if max(img.size) > 1280:
                img.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            # White underneath so a transparent canvas does not become black on a phone.
            canvas = Image.new("RGB", img.size, (255, 255, 255))
            canvas.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            out = io.BytesIO()
            canvas.save(out, format="PNG", optimize=True)
            encoded = out.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise TwilioError("That drawing isn't a picture we can send.") from exc
    if len(encoded) > MAX_MEDIA_BYTES:
        raise TwilioError("That drawing is too large to send as a picture.")
    return encoded


def store_png(raw: bytes, suffix: str = ".png") -> str:
    name = f"{secrets.token_hex(16)}{suffix}"
    media_file(name).write_bytes(raw)
    return name


def store_inbound_media(raw: bytes, content_type: str) -> tuple[str, str]:
    kind = (content_type or "").split(";", 1)[0].strip().lower()
    suffix = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }.get(kind, ".bin")
    name = f"{secrets.token_hex(16)}{suffix}"
    media_file(name).write_bytes(raw)
    return name, kind or "application/octet-stream"


def user_by_phone(db: Session, phone: str) -> User | None:
    number = normalize_e164(phone)
    if not number:
        return None
    return db.scalar(select(User).where(User.phone == number))


def assert_unique_phone(db: Session, phone: str | None, *, skip_id: int | None = None) -> None:
    if not phone:
        return
    existing = user_by_phone(db, phone)
    if existing is not None and existing.id != skip_id:
        raise TwilioError(f"{existing.name} already uses that number.")


def _twilio_error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
        message = str(body.get("message") or body.get("error_message") or "").strip()
        if message:
            # Twilio sometimes echoes request URLs; never return token-like values.
            if "Auth" in message or "auth_token" in message.lower():
                return (
                    "Twilio rejected the request. Check the Account SID, Auth Token "
                    "and From number."
                )
            return message
    except ValueError:
        pass
    if response.status_code in (401, 403):
        return "Twilio rejected the Account SID or Auth Token."
    if response.status_code == 404:
        return "Twilio could not find that resource."
    return f"Twilio returned an error ({response.status_code})."


def _request(
    cfg: TwilioConfig,
    method: str,
    url: str,
    *,
    data: dict[str, str] | None = None,
    content: bytes | None = None,
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
) -> httpx.Response:
    with build_client() as client:
        response = client.request(
            method,
            url,
            auth=cfg.auth,
            data=data,
            content=content,
            headers=headers,
            params=params,
        )
    return response


def ensure_media_service(db: Session, cfg: TwilioConfig) -> str:
    """Return a Conversations service SID Twilio MCS can store media under."""
    if cfg.service_sid:
        return cfg.service_sid
    listed = _request(cfg, "GET", f"{CONVERSATIONS_API}/Services")
    if listed.status_code == 200:
        for item in listed.json().get("services") or []:
            if item.get("friendly_name") == SERVICE_NAME and item.get("sid"):
                sid = str(item["sid"])
                write_setting(db, "twilio_conversations_service_sid", sid)
                db.commit()
                return sid
        # Reuse the first existing service rather than failing if the name differs.
        services = listed.json().get("services") or []
        if services and services[0].get("sid"):
            sid = str(services[0]["sid"])
            write_setting(db, "twilio_conversations_service_sid", sid)
            db.commit()
            return sid
    created = _request(
        cfg,
        "POST",
        f"{CONVERSATIONS_API}/Services",
        data={"FriendlyName": SERVICE_NAME},
    )
    if created.status_code not in (200, 201) or not (created.json() or {}).get("sid"):
        raise TwilioError(
            "Could not prepare Twilio to host a picture. "
            "The text can still be sent without the drawing."
        )
    sid = str(created.json()["sid"])
    write_setting(db, "twilio_conversations_service_sid", sid)
    db.commit()
    return sid


def upload_png_for_mms(db: Session, cfg: TwilioConfig, png: bytes) -> str:
    """Upload a PNG to Twilio MCS and return a short-lived public MediaUrl."""
    service = ensure_media_service(db, cfg)
    response = _request(
        cfg,
        "POST",
        f"{MCS_API}/Services/{service}/Media",
        content=png,
        headers={"Content-Type": "image/png", "Content-Size": str(len(png))},
    )
    if response.status_code not in (200, 201):
        raise TwilioError(_twilio_error_message(response))
    payload = response.json() or {}
    url = (payload.get("links") or {}).get("content_direct_temporary")
    if not url or not str(url).startswith("https://"):
        raise TwilioError("Twilio accepted the picture but did not return a usable link.")
    return str(url)


def _create_twilio_message(
    cfg: TwilioConfig, to: str, body: str, media_url: str | None
) -> dict[str, Any]:
    form = {"To": to, "From": cfg.from_number, "Body": body}
    if media_url:
        form["MediaUrl"] = media_url
    response = _request(
        cfg,
        "POST",
        f"{TWILIO_API}/Accounts/{cfg.account_sid}/Messages.json",
        data=form,
    )
    if response.status_code not in (200, 201):
        raise TwilioError(_twilio_error_message(response))
    return response.json()


def send_to_user(
    db: Session,
    user: User,
    body: str,
    *,
    png: str | bytes | None = None,
) -> FamilyMessage:
    """Send an SMS, or an MMS when a doodle is provided, to a saved family member."""
    cfg = load_config(db)
    if not cfg.configured:
        raise TwilioError("Add your Twilio details in Settings first.")
    if not user.phone or not valid_e164(user.phone):
        raise TwilioError(f"{user.name} does not have a phone number yet.")
    text = (body or "").strip()
    if len(text) > MAX_BODY:
        raise TwilioError(f"A message can be at most {MAX_BODY} characters.")
    if not text and not png:
        raise TwilioError("Type a message or add a drawing first.")
    _check_rate()

    media_path = None
    media_type = None
    media_url = None
    fallback_note = ""
    if png:
        # Re-encode so a hostile payload cannot travel as "PNG".
        prepared = decode_png(png)
        media_path = store_png(prepared)
        media_type = "image/png"
        try:
            media_url = upload_png_for_mms(db, load_config(db), prepared)
        except TwilioError as exc:
            log.warning("MMS media upload failed; sending the text without the picture: %s", exc)
            fallback_note = "A drawing was made, but it couldn't be sent as a picture."
            media_url = None

    send_body = text
    if fallback_note:
        send_body = f"{text}\n\n{fallback_note}".strip() if text else fallback_note

    row = FamilyMessage(
        user_id=user.id,
        phone=user.phone,
        direction="out",
        body=text or None,
        media_path=media_path,
        media_content_type=media_type,
        status="queued",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    try:
        # Reload config in case ensure_media_service wrote a service SID.
        result = _create_twilio_message(load_config(db), user.phone, send_body, media_url)
        row.twilio_sid = result.get("sid")
        row.status = str(result.get("status") or "queued")
        err = (
            result.get("error_message") or result.get("message")
            if result.get("error_code")
            else None
        )
        if err:
            row.error_message = str(err)
        if fallback_note and not row.error_message:
            row.error_message = fallback_note
    except TwilioError as exc:
        row.status = "failed"
        row.error_message = str(exc)
        db.commit()
        raise
    db.commit()
    db.refresh(row)
    return row


def _parse_twilio_date(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(value, fmt)
            if parsed.tzinfo is not None:
                return parsed.astimezone(UTC).replace(tzinfo=None)
            return parsed
        except ValueError:
            continue
    return None


def _known_sids(db: Session, sids: list[str]) -> set[str]:
    if not sids:
        return set()
    rows = db.scalars(select(FamilyMessage.twilio_sid).where(FamilyMessage.twilio_sid.in_(sids)))
    return {sid for sid in rows if sid}


def _download_inbound_media(
    cfg: TwilioConfig, message_sid: str
) -> tuple[str, str] | tuple[None, None]:
    listed = _request(
        cfg,
        "GET",
        f"{TWILIO_API}/Accounts/{cfg.account_sid}/Messages/{message_sid}/Media.json",
    )
    if listed.status_code != 200:
        log.warning("Could not list media for an inbound message")
        return None, None
    items = listed.json().get("media_list") or []
    if not items:
        return None, None
    item = items[0]
    media_sid = item.get("sid")
    content_type = str(item.get("content_type") or "application/octet-stream")
    if not media_sid:
        return None, None
    fetched = _request(
        cfg,
        "GET",
        f"{TWILIO_API}/Accounts/{cfg.account_sid}/Messages/{message_sid}/Media/{media_sid}",
    )
    if fetched.status_code != 200 or not fetched.content:
        log.warning("Could not download inbound MMS media")
        return None, None
    # Redirects can leave us with HTML if auth failed; require a binary-ish payload.
    if fetched.headers.get("content-type", "").startswith("text/html"):
        return None, None
    kind = fetched.headers.get("content-type") or content_type
    name, kind = store_inbound_media(fetched.content, kind)
    return name, kind


def ingest_inbound(db: Session, cfg: TwilioConfig) -> int:
    params = {"To": cfg.from_number, "PageSize": "50"}
    if cfg.poll_since:
        params["DateSent>"] = cfg.poll_since
    response = _request(
        cfg,
        "GET",
        f"{TWILIO_API}/Accounts/{cfg.account_sid}/Messages.json",
        params=params,
    )
    if response.status_code != 200:
        raise TwilioError(_twilio_error_message(response))
    messages = response.json().get("messages") or []
    inbound = [m for m in messages if str(m.get("direction") or "") == "inbound" and m.get("sid")]
    known = _known_sids(db, [str(m["sid"]) for m in inbound])
    added = 0
    for item in inbound:
        sid = str(item["sid"])
        if sid in known:
            continue
        from_number = normalize_e164(str(item.get("from") or item.get("from_") or ""))
        if not valid_e164(from_number):
            continue
        # Never auto-reply, including to unknown numbers.
        member = user_by_phone(db, from_number)
        body = str(item.get("body") or "") or None
        media_path = None
        media_type = None
        try:
            if int(item.get("num_media") or 0) > 0:
                media_path, media_type = _download_inbound_media(cfg, sid)
        except (TypeError, ValueError):
            media_path, media_type = _download_inbound_media(cfg, sid)
        sent_at = _parse_twilio_date(item.get("date_sent") or item.get("date_created"))
        row = FamilyMessage(
            user_id=member.id if member else None,
            phone=from_number,
            direction="in",
            body=body,
            media_path=media_path,
            media_content_type=media_type,
            status=str(item.get("status") or "received"),
            twilio_sid=sid,
        )
        if sent_at is not None:
            row.created_at = sent_at
        db.add(row)
        added += 1
        known.add(sid)
    if added:
        db.commit()
    return added


def refresh_statuses(db: Session, cfg: TwilioConfig) -> int:
    pending = list(
        db.scalars(
            select(FamilyMessage)
            .where(
                FamilyMessage.direction == "out",
                FamilyMessage.twilio_sid.is_not(None),
                FamilyMessage.status.in_(PENDING_STATUSES),
            )
            .order_by(FamilyMessage.updated_at.desc())
            .limit(40)
        )
    )
    if not pending:
        return 0
    changed = 0
    for row in pending:
        response = _request(
            cfg,
            "GET",
            f"{TWILIO_API}/Accounts/{cfg.account_sid}/Messages/{row.twilio_sid}.json",
        )
        if response.status_code != 200:
            continue
        payload = response.json()
        status = str(payload.get("status") or row.status)
        error = payload.get("error_message")
        if status != row.status or (error and error != row.error_message):
            row.status = status
            if error:
                row.error_message = str(error)
            changed += 1
    if changed:
        db.commit()
    return changed


def poll_once(db: Session | None = None) -> int:
    close = False
    if db is None:
        from ..db import SessionLocal

        db = SessionLocal()
        close = True
    try:
        cfg = load_config(db)
        if not cfg.configured:
            return 0
        return ingest_inbound(db, cfg) + refresh_statuses(db, cfg)
    except TwilioError:
        log.warning("Twilio poll failed")
        return 0
    finally:
        if close:
            db.close()


def test_send(db: Session, user: User) -> FamilyMessage:
    return send_to_user(db, user, "This is a test message from Mantel.")


def account_ok(cfg: TwilioConfig) -> tuple[bool, str]:
    if not cfg.configured:
        return False, "Add your Twilio Account SID, Auth Token and From number first."
    response = _request(cfg, "GET", f"{TWILIO_API}/Accounts/{cfg.account_sid}.json")
    if response.status_code == 200:
        return True, "Connected to Twilio."
    return False, _twilio_error_message(response)


def media_url_host_is_twilio(url: str) -> bool:
    """Used by tests to assert we never point Twilio at the LAN server."""
    host = (urlparse(url).hostname or "").lower()
    return host.endswith("twilio.com") or host.endswith("twiliocdn.com") or host.endswith("twil.io")

