"""Family SMS/MMS through Twilio."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import FamilyMessage, User
from ..services import twilio_messages as sms

router = APIRouter(prefix="/messages", tags=["messages"])

QUICK_REPLIES = ["Dinner's ready", "Call me", "On my way?"]


class SendPayload(BaseModel):
    user_id: int
    body: str = ""
    media_base64: str | None = None


class TestPayload(BaseModel):
    user_id: int | None = Field(
        default=None,
        description="Family member to text. Defaults to the first person with a number.",
    )


def _http(exc: sms.TwilioError) -> HTTPException:
    status = 429 if isinstance(exc, sms.RateLimitError) else 400
    return HTTPException(status, str(exc))


def _iso(value) -> str | None:
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is None:
        return value.isoformat() + "Z"
    return value.isoformat()


def _message_out(row: FamilyMessage) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "phone": row.phone,
        "direction": row.direction,
        "body": row.body,
        "media_url": f"/api/messages/{row.id}/media" if row.media_path else None,
        "media_content_type": row.media_content_type,
        "status": row.status,
        "error_message": row.error_message,
        "created_at": _iso(row.created_at),
    }


def _conversation_id(user_id: int | None, phone: str) -> str:
    if user_id is not None:
        return f"user-{user_id}"
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return f"phone-{digits}"


def _parse_conversation(db: Session, conversation_id: str) -> tuple[User | None, str | None]:
    if conversation_id.startswith("user-"):
        try:
            user_id = int(conversation_id.removeprefix("user-"))
        except ValueError as exc:
            raise HTTPException(404, "Conversation not found") from exc
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(404, "Conversation not found")
        return user, user.phone
    if conversation_id.startswith("phone-"):
        digits = conversation_id.removeprefix("phone-")
        if not digits.isdigit():
            raise HTTPException(404, "Conversation not found")
        phone = sms.normalize_e164(digits)
        if not sms.valid_e164(phone):
            raise HTTPException(404, "Conversation not found")
        return sms.user_by_phone(db, phone), phone
    raise HTTPException(404, "Conversation not found")


def _last_message(db: Session, phone: str | None, user_id: int | None) -> FamilyMessage | None:
    stmt = select(FamilyMessage).order_by(FamilyMessage.created_at.desc(), FamilyMessage.id.desc())
    if user_id is not None:
        stmt = stmt.where(FamilyMessage.user_id == user_id)
    elif phone:
        stmt = stmt.where(FamilyMessage.phone == phone, FamilyMessage.user_id.is_(None))
    else:
        return None
    return db.scalars(stmt.limit(1)).first()


@router.get(
    "/conversations",
    summary="List message threads",
    description=(
        "One thread per family member who has a phone number, plus a thread for each "
        "unknown inbound number."
    ),
)
def list_conversations(db: Session = Depends(get_db)) -> dict:
    cfg_ok = sms.configured(db)
    people = list(db.scalars(select(User).order_by(User.sort_order, User.id)))
    threads: list[dict] = []
    used_phones: set[str] = set()
    for user in people:
        if not user.phone and not db.scalar(
            select(func.count()).select_from(FamilyMessage).where(FamilyMessage.user_id == user.id)
        ):
            continue
        if user.phone:
            used_phones.add(user.phone)
        last = _last_message(db, user.phone, user.id)
        threads.append(
            {
                "id": _conversation_id(user.id, user.phone or ""),
                "user_id": user.id,
                "name": user.name,
                "phone": user.phone,
                "color": user.color,
                "avatar_emoji": user.avatar_emoji,
                "unknown": False,
                "last_message": _message_out(last) if last else None,
            }
        )

    unknown_phones = db.scalars(
        select(FamilyMessage.phone)
        .where(FamilyMessage.user_id.is_(None))
        .distinct()
    )
    unknown_threads: list[dict] = []
    for phone in unknown_phones:
        if not phone or phone in used_phones:
            continue
        last = _last_message(db, phone, None)
        unknown_threads.append(
            {
                "id": _conversation_id(None, phone),
                "user_id": None,
                "name": "Unknown",
                "phone": phone,
                "color": "#64748b",
                "avatar_emoji": None,
                "unknown": True,
                "last_message": _message_out(last) if last else None,
            }
        )
    unknown_threads.sort(
        key=lambda t: (t["last_message"] or {}).get("created_at") or "",
        reverse=True,
    )
    return {
        "configured": cfg_ok,
        "from_number": sms.load_config(db).from_number if cfg_ok else "",
        "quick_replies": QUICK_REPLIES,
        "conversations": threads + unknown_threads,
    }


@router.get(
    "/conversations/{conversation_id}",
    summary="Messages in one thread",
)
def get_conversation(conversation_id: str, db: Session = Depends(get_db)) -> dict:
    user, phone = _parse_conversation(db, conversation_id)
    if user is not None:
        rows = list(
            db.scalars(
                select(FamilyMessage)
                .where(FamilyMessage.user_id == user.id)
                .order_by(FamilyMessage.created_at, FamilyMessage.id)
            )
        )
        name, color, emoji, unknown = user.name, user.color, user.avatar_emoji, False
        phone = user.phone
    else:
        rows = list(
            db.scalars(
                select(FamilyMessage)
                .where(FamilyMessage.phone == phone, FamilyMessage.user_id.is_(None))
                .order_by(FamilyMessage.created_at, FamilyMessage.id)
            )
        )
        name, color, emoji, unknown = "Unknown", "#64748b", None, True
    return {
        "id": _conversation_id(user.id if user else None, phone or ""),
        "user_id": user.id if user else None,
        "name": name,
        "phone": phone,
        "color": color,
        "avatar_emoji": emoji,
        "unknown": unknown,
        "can_send": bool(user and user.phone and sms.configured(db)),
        "messages": [_message_out(row) for row in rows],
    }


@router.post(
    "",
    status_code=201,
    summary="Send a text or doodle to a family member",
)
def send_message(payload: SendPayload, db: Session = Depends(get_db)) -> dict:
    user = db.get(User, payload.user_id)
    if user is None:
        raise HTTPException(404, "Family member not found")
    try:
        row = sms.send_to_user(db, user, payload.body, png=payload.media_base64)
    except sms.TwilioError as exc:
        raise _http(exc) from exc
    return _message_out(row)


@router.post(
    "/test",
    status_code=201,
    summary="Send a test text to a family member",
)
def send_test(payload: TestPayload | None = None, db: Session = Depends(get_db)) -> dict:
    payload = payload or TestPayload()
    user = None
    if payload.user_id is not None:
        user = db.get(User, payload.user_id)
        if user is None:
            raise HTTPException(404, "Family member not found")
    else:
        people = list(db.scalars(select(User).order_by(User.sort_order, User.id)))
        user = next((p for p in people if p.phone), None)
        if user is None:
            raise HTTPException(
                400, "Add a phone number to a family member in Settings first, then send a test."
            )
    try:
        row = sms.test_send(db, user)
    except sms.TwilioError as exc:
        raise _http(exc) from exc
    return _message_out(row)


@router.get(
    "/{message_id}/media",
    summary="Fetch a stored picture from a message",
)
def get_media(message_id: int, db: Session = Depends(get_db)):
    row = db.get(FamilyMessage, message_id)
    if row is None or not row.media_path:
        raise HTTPException(404, "Picture not found")
    try:
        path = sms.media_file(row.media_path)
    except sms.TwilioError as exc:
        raise HTTPException(404, str(exc)) from exc
    if not path.is_file():
        raise HTTPException(404, "Picture not found")
    return FileResponse(path, media_type=row.media_content_type or "application/octet-stream")
