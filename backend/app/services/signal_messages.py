"""Family messaging through a self-hosted signal-cli REST API.

The wall talks only to a local container (default http://host.docker.internal:8081),
never to Signal's servers itself. Pictures go as base64 attachments on /v2/send, so
nothing needs a public URL. Inbound messages are pulled with GET /v1/receive in
normal mode, on the same few-second cadence as Twilio.
"""

from __future__ import annotations

import base64
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import FamilyMessage, User
from . import twilio_messages as common

log = logging.getLogger(__name__)

DEFAULT_API_URL = "http://host.docker.internal:8081"
DEVICE_NAME = "Mantel"
REQUEST_TIMEOUT = 30.0
QR_TIMEOUT = 90.0
RECEIVE_HTTP_TIMEOUT = 40.0

# "read" outranks "delivered" outranks "sent".
_STATUS_RANK = {
    "queued": 0,
    "accepted": 0,
    "scheduled": 0,
    "sending": 1,
    "sent": 2,
    "delivered": 3,
    "read": 4,
}


class SignalError(common.TwilioError):
    """Safe to show the user. Never includes credentials."""


class AttachmentRejected(SignalError):
    pass


class DeliveryUnconfirmed(SignalError):
    pass


@dataclass(frozen=True)
class SignalConfig:
    api_url: str
    account_number: str

    @property
    def configured(self) -> bool:
        return bool(self.api_url and common.valid_e164(self.account_number))


def build_client(timeout: float = REQUEST_TIMEOUT) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=True)


def normalize_api_url(raw: str) -> str:
    text = (raw or "").strip().rstrip("/")
    if not text:
        return ""
    parsed = urlparse(text)
    if parsed.scheme not in ("http", "https"):
        raise SignalError("The Signal API address must start with http:// or https://")
    if parsed.username or parsed.password:
        raise SignalError("The Signal API address can't include a username or password.")
    if not parsed.hostname:
        raise SignalError("The Signal API address is missing a host.")
    return text


def load_config(db: Session) -> SignalConfig:
    raw_url = str(common._setting(db, "signal_api_url") or "") or DEFAULT_API_URL
    try:
        url = normalize_api_url(raw_url)
    except SignalError:
        url = ""
    raw_number = str(common._setting(db, "signal_account_number") or "")
    number = common.normalize_e164(raw_number) if raw_number else ""
    return SignalConfig(api_url=url, account_number=number)


def configured(db: Session) -> bool:
    return load_config(db).configured


def normalize_signal_uuid(raw: str | None) -> str:
    """Return a lowercase dashed UUID, or '' if the value isn't one.

    signal-cli may prefix the identifier with ACI: or PNI:.
    """
    text = (raw or "").strip()
    if not text:
        return ""
    if ":" in text:
        text = text.split(":")[-1].strip()
    try:
        return str(uuid.UUID(text))
    except (ValueError, AttributeError, TypeError):
        return ""


def user_by_signal_uuid(db: Session, value: str | None) -> User | None:
    ident = normalize_signal_uuid(value)
    if not ident:
        return None
    return db.scalar(select(User).where(User.signal_uuid == ident))


def assert_unique_signal_uuid(
    db: Session, value: str | None, *, skip_id: int | None = None
) -> None:
    if not value:
        return
    existing = user_by_signal_uuid(db, value)
    if existing is not None and existing.id != skip_id:
        raise SignalError(f"{existing.name} already uses that Signal ID.")


def _error_from(response: httpx.Response) -> str:
    try:
        body = response.json()
        message = str(body.get("error") or body.get("message") or body.get("reason") or "").strip()
        if message:
            short = message.split("\n")[0][:300]
            log.warning("Signal API error %s: %s", response.status_code, short)
            return short
    except ValueError:
        pass
    if response.status_code in (401, 403):
        return "The Signal API refused the request."
    if response.status_code == 404:
        return "The Signal API didn't have that resource."
    log.warning("Signal API error %s", response.status_code)
    return "The Signal API didn't accept that request."


def _request(
    cfg: SignalConfig,
    method: str,
    path: str,
    *,
    timeout: float = REQUEST_TIMEOUT,
    json: Any = None,
    params: dict[str, Any] | None = None,
) -> httpx.Response:
    if not cfg.api_url:
        raise SignalError("Add the Signal API address in Settings first.")
    url = f"{cfg.api_url}{path}"
    try:
        with build_client(timeout) as client:
            return client.request(method, url, json=json, params=params)
    except httpx.TimeoutException as exc:
        raise SignalError(
            "The Signal API didn't answer in time. Is the signal-api container running?"
        ) from exc
    except httpx.RequestError as exc:
        raise SignalError(
            "Couldn't reach the Signal API. Check the address and that the container is running."
        ) from exc


def probe_about(cfg: SignalConfig) -> dict[str, Any]:
    response = _request(cfg, "GET", "/v1/about", timeout=15.0)
    if response.status_code != 200:
        raise SignalError(_error_from(response))
    try:
        return response.json()
    except ValueError as exc:
        raise SignalError("The Signal API didn't return a valid status.") from exc


def list_accounts(cfg: SignalConfig) -> list[dict[str, str]]:
    response = _request(cfg, "GET", "/v1/accounts", timeout=30.0)
    if response.status_code != 200:
        raise SignalError(_error_from(response))
    try:
        payload = response.json()
    except ValueError as exc:
        raise SignalError("The Signal API didn't return a list of accounts.") from exc
    if not isinstance(payload, list):
        return []
    accounts: list[dict[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        number = common.normalize_e164(str(item.get("number") or ""))
        aci = str(item.get("aci") or "").strip()
        if number or aci:
            accounts.append({"number": number, "aci": aci})
    return accounts


def account_is_linked(cfg: SignalConfig, accounts: list[dict[str, str]] | None = None) -> bool:
    accounts = accounts if accounts is not None else list_accounts(cfg)
    if not accounts:
        return False
    if not cfg.account_number:
        return True
    return any(
        item["number"] == cfg.account_number or item["aci"] == cfg.account_number
        for item in accounts
    )


def status(db: Session) -> dict[str, Any]:
    """Reachability and link state for the Settings screen. Calls the API."""
    cfg = load_config(db)
    if not cfg.api_url:
        return {
            "reachable": False,
            "linked": False,
            "accounts": [],
            "mode": "",
            "error": "Add the Signal API address in Settings first.",
        }
    try:
        about = probe_about(cfg)
        accounts = list_accounts(cfg)
        return {
            "reachable": True,
            "linked": account_is_linked(cfg, accounts),
            "accounts": accounts,
            "mode": str(about.get("mode") or ""),
            "error": None,
        }
    except SignalError as exc:
        return {
            "reachable": False,
            "linked": False,
            "accounts": [],
            "mode": "",
            "error": str(exc),
        }


def fetch_qr(db: Session, *, device_name: str = DEVICE_NAME) -> bytes:
    cfg = load_config(db)
    name = (device_name or DEVICE_NAME).strip() or DEVICE_NAME
    response = _request(
        cfg,
        "GET",
        "/v1/qrcodelink",
        params={"device_name": name},
        timeout=QR_TIMEOUT,
    )
    content_type = (response.headers.get("content-type") or "").lower()
    if response.status_code == 200 and response.content and "json" not in content_type:
        return response.content
    raise SignalError(_error_from(response) if response.content else "Couldn't make a QR code.")


def remember_linked_number(db: Session, accounts: list[dict[str, str]]) -> str:
    """If a device just linked, keep its number so send/receive have an account."""
    cfg = load_config(db)
    if cfg.account_number and account_is_linked(cfg, accounts):
        return cfg.account_number
    for item in accounts:
        if item.get("number") and common.valid_e164(item["number"]):
            common.write_setting(db, "signal_account_number", item["number"])
            db.commit()
            return item["number"]
    return cfg.account_number


def _sid_out(timestamp: Any) -> str:
    return f"signal:{timestamp}"


def _sid_in(phone: str, timestamp: Any) -> str:
    return f"signal:{phone}:{timestamp}"


def _timestamp_of(result: Any) -> str | None:
    if isinstance(result, list) and result:
        result = result[0]
    if isinstance(result, dict):
        value = result.get("timestamp")
        if value is not None:
            return str(value)
    return None


def send_to_user(
    db: Session,
    user: User,
    body: str,
    *,
    png: str | bytes | None = None,
    request_id: str | None = None,
    request_digest: str | None = None,
) -> FamilyMessage:
    cfg = load_config(db)
    if not cfg.configured:
        raise SignalError("Add the Signal API address and account number in Settings first.")
    recipient = normalize_signal_uuid(user.signal_uuid) if user.signal_uuid else ""
    if not recipient:
        if user.phone and common.valid_e164(user.phone):
            recipient = user.phone
        else:
            raise SignalError(f"{user.name} does not have a phone number yet.")
    text = (body or "").strip()
    if len(text) > common.MAX_BODY:
        raise SignalError(f"A message can be at most {common.MAX_BODY} characters.")
    if not text and not png:
        raise SignalError("Type a message or add a drawing first.")
    common._check_rate()

    media_path = None
    media_type = None
    attachment = None
    fallback_note = ""
    if png:
        prepared = common.decode_png(png)
        media_path = common.store_png(prepared)
        media_type = "image/png"
        attachment = base64.b64encode(prepared).decode()

    payload: dict[str, Any] = {
        "message": text or " ",
        "number": cfg.account_number,
        "recipients": [recipient],
        "text_mode": "normal",
    }
    if attachment:
        payload["base64_attachments"] = [attachment]

    row = FamilyMessage(
        user_id=user.id,
        phone=user.phone or "",
        signal_uuid=normalize_signal_uuid(user.signal_uuid) or None,
        direction="out",
        body=text or None,
        media_path=media_path,
        media_content_type=media_type,
        status="unconfirmed",
        request_id=request_id,
        request_digest=request_digest,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    try:
        result = _send_payload(cfg, payload)
    except SignalError as exc:
        if attachment and isinstance(exc, AttachmentRejected):
            log.warning("Signal attachment send failed; retrying as text: %s", exc)
            fallback_note = "A drawing was made, but it couldn't be sent as a picture."
            payload.pop("base64_attachments", None)
            payload["message"] = f"{text}\n\n{fallback_note}".strip() if text else fallback_note
            try:
                result = _send_payload(cfg, payload)
            except SignalError as inner:
                row.status = "unconfirmed" if isinstance(inner, DeliveryUnconfirmed) else "failed"
                row.error_message = str(inner)
                db.commit()
                if isinstance(inner, DeliveryUnconfirmed):
                    return row
                raise
        else:
            row.status = "unconfirmed" if isinstance(exc, DeliveryUnconfirmed) else "failed"
            row.error_message = str(exc)
            db.commit()
            if isinstance(exc, DeliveryUnconfirmed):
                return row
            raise

    timestamp = _timestamp_of(result)
    row.twilio_sid = _sid_out(timestamp) if timestamp else None
    row.status = "sent"
    if fallback_note:
        row.error_message = fallback_note
    db.commit()
    db.refresh(row)
    return row


def _send_payload(cfg: SignalConfig, payload: dict[str, Any]) -> Any:
    try:
        response = _request(cfg, "POST", "/v2/send", json=payload, timeout=REQUEST_TIMEOUT)
    except SignalError as exc:
        raise DeliveryUnconfirmed("Delivery unconfirmed. Check the conversation.") from exc
    if response.status_code >= 500 or response.status_code == 408:
        raise DeliveryUnconfirmed("Delivery unconfirmed. Check the conversation.")
    if response.status_code in (400, 413, 415, 422):
        reason = _error_from(response)
        if response.status_code in (413, 415) or "attachment" in reason.lower():
            raise AttachmentRejected(reason)
    if response.status_code not in (200, 201):
        raise SignalError(_error_from(response))
    try:
        return response.json()
    except ValueError:
        return {}


def test_send(db: Session, user: User) -> FamilyMessage:
    return send_to_user(db, user, "This is a test message from Mantel.")


def _envelope_source(envelope: dict[str, Any]) -> str:
    raw = str(envelope.get("sourceNumber") or envelope.get("source") or "")
    return common.normalize_e164(raw)


def _envelope_uuid(envelope: dict[str, Any]) -> str:
    for key in ("sourceUuid", "sourceServiceId", "sourceUuid"):
        ident = normalize_signal_uuid(str(envelope.get(key) or ""))
        if ident:
            return ident
    return ""


def _envelope_name(envelope: dict[str, Any], data: dict[str, Any] | None = None) -> str | None:
    for source in (envelope, data or {}):
        name = str(source.get("sourceName") or source.get("source_name") or "").strip()
        if name:
            return name[:100]
    return None


def _match_member(db: Session, ident: str, phone: str) -> User | None:
    member = user_by_signal_uuid(db, ident) if ident else None
    if member is not None:
        return member
    if common.valid_e164(phone):
        member = common.user_by_phone(db, phone)
        # Remember the ACI when a known number also arrived with a UUID, so
        # later sends still work if they hide the number. Linking the other
        # way (UUID only, no number) stays manual.
        if member is not None and ident and not member.signal_uuid:
            member.signal_uuid = ident
        return member
    return None


def _envelope_timestamp(envelope: dict[str, Any], data: dict[str, Any] | None = None) -> str:
    for candidate in (
        (data or {}).get("timestamp"),
        envelope.get("timestamp"),
        envelope.get("serverReceivedTimestamp"),
    ):
        if candidate is not None:
            return str(candidate)
    return ""


def _download_attachment(
    cfg: SignalConfig, attachment_id: str, content_type: str
) -> tuple[str, str] | tuple[None, None]:
    if not attachment_id:
        return None, None
    response = _request(cfg, "GET", f"/v1/attachments/{attachment_id}", timeout=REQUEST_TIMEOUT)
    if response.status_code != 200 or not response.content:
        log.warning("Could not download a Signal attachment")
        return None, None
    kind = response.headers.get("content-type") or content_type or "application/octet-stream"
    if kind.startswith("text/html") or kind.startswith("application/json"):
        return None, None
    name, kind = common.store_inbound_media(response.content, kind)
    return name, kind


def _apply_receipt(db: Session, receipt: dict[str, Any]) -> int:
    timestamps = receipt.get("timestamps") or []
    if not timestamps:
        return 0
    if receipt.get("isRead"):
        status = "read"
    elif receipt.get("isDelivery") or receipt.get("isViewed"):
        status = "delivered"
    else:
        return 0
    sids = [_sid_out(ts) for ts in timestamps]
    rows = list(
        db.scalars(
            select(FamilyMessage).where(
                FamilyMessage.direction == "out",
                FamilyMessage.twilio_sid.in_(sids),
            )
        )
    )
    changed = 0
    for row in rows:
        if _STATUS_RANK.get(status, 0) > _STATUS_RANK.get(row.status, 0):
            row.status = status
            changed += 1
    return changed


def _is_group(data: dict[str, Any]) -> bool:
    if data.get("groupInfo") or data.get("groupId") or data.get("group"):
        return True
    return False


def ingest_inbound(db: Session, cfg: SignalConfig) -> int:
    response = _request(
        cfg,
        "GET",
        f"/v1/receive/{cfg.account_number}",
        params={"timeout": "1", "ignore_stories": "true"},
        timeout=RECEIVE_HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        raise SignalError(_error_from(response))
    try:
        events = response.json()
    except ValueError as exc:
        raise SignalError("The Signal API didn't return messages.") from exc
    if not isinstance(events, list):
        return 0

    added = 0
    cleanup_ids = []
    receipts = 0
    for event in events:
        if not isinstance(event, dict):
            continue
        envelope = event.get("envelope")
        if not isinstance(envelope, dict):
            continue
        receipt = envelope.get("receiptMessage")
        if isinstance(receipt, dict):
            receipts += _apply_receipt(db, receipt)
            continue
        data = envelope.get("dataMessage")
        if not isinstance(data, dict):
            continue
        if _is_group(data):
            continue
        phone = _envelope_source(envelope)
        ident = _envelope_uuid(envelope)
        if phone == cfg.account_number:
            continue
        if not ident and not common.valid_e164(phone):
            continue
        timestamp = _envelope_timestamp(envelope, data) or "0"
        sid = _sid_in(phone or ident, timestamp)
        if db.scalar(select(FamilyMessage.id).where(FamilyMessage.twilio_sid == sid)):
            continue
        body = str(data.get("message") or "").strip() or None
        media_path = None
        media_type = None
        attachments = data.get("attachments") or []
        if isinstance(attachments, list) and attachments:
            first = attachments[0] if isinstance(attachments[0], dict) else {}
            att_id = str(first.get("id") or "")
            content_type = str(first.get("contentType") or first.get("content_type") or "")
            media_path, media_type = _download_attachment(cfg, att_id, content_type)
        if not body and not media_path:
            continue
        # Never auto-reply, including to unknown numbers. Never auto-link a
        # UUID-only sender to a member whose number failed as unregistered.
        member = _match_member(db, ident, phone)
        stored_phone = ""
        if member is not None:
            stored_phone = member.phone or (phone if common.valid_e164(phone) else "")
        elif common.valid_e164(phone):
            stored_phone = phone
        row = FamilyMessage(
            user_id=member.id if member else None,
            phone=stored_phone,
            signal_uuid=ident or None,
            sender_name=None if member is not None else _envelope_name(envelope, data),
            direction="in",
            body=body,
            media_path=media_path,
            media_content_type=media_type,
            status="received",
            twilio_sid=sid,
        )
        try:
            millis = int(timestamp)
            if millis > 10_000_000_000:
                row.created_at = datetime.fromtimestamp(millis / 1000, UTC).replace(tzinfo=None)
        except (TypeError, ValueError, OSError):
            pass
        db.add(row)
        if media_path:
            cleanup_ids.append(att_id)
        added += 1
    if added or receipts:
        db.commit()
    for attachment_id in cleanup_ids:
        try:
            _request(cfg, "DELETE", f"/v1/attachments/{attachment_id}", timeout=15.0)
        except SignalError:
            pass
    return added + receipts


def list_unlinked_senders(db: Session) -> list[dict[str, Any]]:
    """Recent inbound senders we couldn't match to a family member."""
    rows = list(
        db.scalars(
            select(FamilyMessage)
            .where(
                FamilyMessage.user_id.is_(None),
                FamilyMessage.signal_uuid.is_not(None),
                FamilyMessage.direction == "in",
            )
            .order_by(FamilyMessage.created_at.desc(), FamilyMessage.id.desc())
        )
    )
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        ident = row.signal_uuid or ""
        if not ident:
            continue
        if ident in grouped:
            grouped[ident]["message_count"] += 1
            continue
        created = row.created_at
        if created is not None and getattr(created, "tzinfo", None) is None:
            last_seen = created.isoformat() + "Z"
        elif created is not None:
            last_seen = created.isoformat()
        else:
            last_seen = None
        grouped[ident] = {
            "signal_uuid": ident,
            "name": (row.sender_name or "").strip() or "Unknown",
            "last_seen": last_seen,
            "message_count": 1,
        }
    return list(grouped.values())


def link_sender(db: Session, ident: str, user: User) -> User:
    value = normalize_signal_uuid(ident)
    if not value:
        raise SignalError("That Signal ID isn't valid.")
    assert_unique_signal_uuid(db, value, skip_id=user.id)
    user.signal_uuid = value
    rows = list(
        db.scalars(
            select(FamilyMessage).where(
                FamilyMessage.signal_uuid == value,
                FamilyMessage.user_id.is_(None),
            )
        )
    )
    for row in rows:
        row.user_id = user.id
        if not row.phone and user.phone:
            row.phone = user.phone
    db.commit()
    db.refresh(user)
    return user


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
        return ingest_inbound(db, cfg)
    except SignalError:
        log.warning("Signal poll failed")
        return 0
    finally:
        if close:
            db.close()
