"""Pairing phones and browsers with this calendar.

The wall display does not use these routes to log in. On the default
`AUTH_MODE=lan` it is already trusted, because it runs on the same machine.
A phone that is away from home is not. Someone standing at the wall taps
"Pair a phone", reads the code (or lets the phone scan it), and the app
exchanges that code for a token it stores. The token is shown once. Revoking
the device in Settings deletes the hash, and the next call from that phone
fails until it is paired again.

See docs/authentication.md for the scheme the iOS and Android clients should
implement. The same text is summarised on each route below, which is what
`/api/docs` renders.
"""

import io
import re
from urllib.parse import quote, urlparse

import segno
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Device, PairingCode, utcnow
from ..services.auth import (
    PAIRING_TTL,
    client_host,
    consume_valid_code,
    hash_code,
    hash_token,
    network_trusted,
    new_device_token,
    new_pairing_code,
    normalize_code,
    record_failure,
    token_prefix,
    too_many_attempts,
)
from ..timeutil import as_utc

router = APIRouter(prefix="/auth", tags=["auth"])


class DeviceOut(BaseModel):
    id: int
    name: str
    token_prefix: str = Field(
        description="First characters of the token, so a device can be recognised. Not a secret."
    )
    created_at: str
    last_used_at: str | None


class PairingCodeOut(BaseModel):
    code: str = Field(description="Shown on the wall. Single use, expires in about ten minutes.")
    expires_at: str
    qr_payload: str = Field(
        description=(
            "Text to put in a QR code: mantel://pair?v=1&base=<server>&code=<code>. "
            "A phone app parses `base` (the server origin) and `code`, then POSTs /api/auth/pair."
        )
    )
    qr_svg: str = Field(description="The same payload as an SVG document, ready to display.")


class PairIn(BaseModel):
    code: str = Field(description="The code currently on the wall, with or without the dash.")
    name: str = Field(
        default="Phone",
        max_length=100,
        description="What to call this device in Settings, e.g. \"Matt's iPhone\".",
    )


class PairedOut(BaseModel):
    token: str = Field(description="Secret. Shown once. Send as Authorization: Bearer.")
    token_type: str = "bearer"
    device: DeviceOut


class AuthStatusOut(BaseModel):
    auth_mode: str = Field(description="lan, local, token, or off.")
    network_trusted: bool = Field(
        description="True when this request's address would be allowed with no token."
    )
    authorization_required: bool = Field(
        description=(
            "True when a caller from this address must send a device token. "
            "False on the wall display under the default configuration."
        )
    )


def _iso(moment) -> str | None:
    tagged = as_utc(moment)
    return tagged.isoformat().replace("+00:00", "Z") if tagged else None


def _device_out(device: Device) -> DeviceOut:
    return DeviceOut(
        id=device.id,
        name=device.name,
        token_prefix=device.token_prefix,
        created_at=_iso(device.created_at) or "",
        last_used_at=_iso(device.last_used_at),
    )


def _safe_base(url: str) -> str | None:
    """An origin only. A base with a userinfo or a non-http scheme would let a
    crafted request point a phone's pairing QR at somewhere else."""
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    if parsed.username or parsed.password:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _qr_svg(payload: str) -> str:
    """The QR as a standalone SVG document an <img> can show.

    segno's `svg_inline` is meant to be pasted into HTML, so it leaves out
    `xmlns="http://www.w3.org/2000/svg"`; as an image (a data: URI) that renders as a
    broken picture. This is the full form, with a viewBox so CSS can size it, a solid white
    background and a four-module quiet zone so a scanner reads it on a dark theme too."""
    out = io.BytesIO()
    segno.make(payload, error="m").save(
        out, kind="svg", scale=1, border=4, dark="#000", light="#fff", xmldecl=False, svgns=True
    )
    svg = out.getvalue().decode("utf-8")
    size = re.search(r'width="(\d+)" height="(\d+)"', svg)
    if size and "viewBox" not in svg:
        svg = svg.replace(
            size.group(0),
            f'viewBox="0 0 {size.group(1)} {size.group(2)}" width="{size.group(1)}" '
            f'height="{size.group(2)}" shape-rendering="crispEdges"',
            1,
        )
    return svg


def _qr_payload(base: str, code: str) -> str:
    return f"mantel://pair?v=1&base={quote(base, safe='')}&code={quote(code, safe='')}"


@router.get(
    "/status",
    response_model=AuthStatusOut,
    summary="Whether this caller needs a token",
    description=(
        "Public. Reports the configured auth mode and whether the address this "
        "request came from is trusted. Phone apps can call it before pairing to "
        "decide whether to show a code prompt. It returns no calendar data.\n\n"
        "Under the default `AUTH_MODE=lan`, a request from the home network "
        "(and from the wall display itself) has `authorization_required: false`. "
        "A request from the public internet has `authorization_required: true`."
    ),
)
def status(request: Request) -> AuthStatusOut:
    from ..config import get_settings

    settings = get_settings()
    trusted = network_trusted(client_host(request, settings), settings)
    return AuthStatusOut(
        auth_mode=settings.auth_mode.strip().lower(),
        network_trusted=trusted,
        authorization_required=not trusted and settings.auth_mode.strip().lower() != "off",
    )


@router.post(
    "/pairing-codes",
    response_model=PairingCodeOut,
    summary="Show a pairing code on the wall",
    description=(
        "Creates a single-use code that a phone exchanges at `POST /api/auth/pair`. "
        "The previous unused code is invalidated, so the wall only ever has one "
        "live code. Requires a trusted network or an existing device token — a "
        "stranger on the internet cannot mint codes.\n\n"
        "`base_url` should be the origin the phone will call (what the wall's "
        "browser is open on, such as `http://192.168.1.20:8080`). It is embedded "
        "in `qr_payload` and in the SVG. When omitted, the request's own origin "
        "is used."
    ),
)
def create_pairing_code(
    request: Request,
    base_url: str | None = None,
    db: Session = Depends(get_db),
) -> PairingCodeOut:
    base = _safe_base(base_url) if base_url else None
    if base is None:
        base = _safe_base(str(request.base_url))
    if base is None:
        raise HTTPException(400, "base_url must be an http or https origin")

    # One code on the screen. A second tap replaces it rather than leaving a
    # pile of live codes in the database.
    db.execute(delete(PairingCode).where(PairingCode.used_at.is_(None)))
    code = new_pairing_code()
    expires = utcnow() + PAIRING_TTL
    db.add(PairingCode(code_hash=hash_code(normalize_code(code)), expires_at=expires))
    db.commit()

    payload = _qr_payload(base, code)
    svg = _qr_svg(payload)
    return PairingCodeOut(
        code=code,
        expires_at=_iso(expires) or "",
        qr_payload=payload,
        qr_svg=svg,
    )


@router.post(
    "/pair",
    response_model=PairedOut,
    status_code=201,
    summary="Exchange a pairing code for a device token",
    description=(
        "Public: the phone has no token yet. Send the code from the wall and a "
        "name for the device. The response carries the token **once**. Store it; "
        "the server keeps only a hash. Later requests send `Authorization: Bearer <token>`.\n\n"
        "The code is single use and expires about ten minutes after it was shown. "
        "Wrong codes are rate limited per address. A revoked device is just a "
        "deleted row — pair again for a new token.\n\n"
        "The QR on the wall encodes `mantel://pair?v=1&base=<origin>&code=<code>`. "
        "Parse `base` as the server origin and POST here."
    ),
)
def pair(payload: PairIn, request: Request, db: Session = Depends(get_db)) -> PairedOut:
    host = client_host(request)
    if too_many_attempts(host):
        raise HTTPException(
            429, "Too many pairing attempts from this address. Wait a few minutes and try again."
        )
    normalized = normalize_code(payload.code)
    if not consume_valid_code(db, normalized):
        record_failure(host)
        db.rollback()
        raise HTTPException(401, "That pairing code is wrong or has expired.")

    name = payload.name.strip() or "Phone"
    raw = new_device_token()
    device = Device(name=name[:100], token_hash=hash_token(raw), token_prefix=token_prefix(raw))
    db.add(device)
    db.commit()
    db.refresh(device)
    return PairedOut(token=raw, device=_device_out(device))


@router.get(
    "/devices",
    response_model=list[DeviceOut],
    summary="List paired devices",
    description=(
        "Devices that currently hold a token. The token itself is not returned. "
        "`token_prefix` is the start of it, so you can tell two phones apart. "
        "`last_used_at` moves at most every few minutes."
    ),
)
def list_devices(db: Session = Depends(get_db)) -> list[DeviceOut]:
    rows = db.scalars(select(Device).order_by(Device.created_at, Device.id)).all()
    return [_device_out(row) for row in rows]


@router.delete(
    "/devices/{device_id}",
    status_code=204,
    summary="Revoke a paired device",
    description=(
        "Deletes the device and its token hash. The phone's next request is "
        "rejected until someone pairs it again from the wall. There is no undo."
    ),
)
def revoke_device(device_id: int, db: Session = Depends(get_db)) -> None:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(404, "Device not found")
    db.delete(device)
    db.commit()
