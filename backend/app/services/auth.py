"""Device tokens and the decision of whether a request may proceed.

Two ways in, on purpose:

* The wall display. Chromium on the Pi talks to the published Docker port, so
  the container sees a private address (the bridge gateway, or a LAN address),
  not 127.0.0.1. `AUTH_MODE=lan` trusts those addresses and the kiosk never
  asks anyone to log in.
* A phone that is not on that network. It trades a short code shown in
  Settings for a bearer token. The token is stored only as a SHA-256 hash.

Pairing codes are hashed with HMAC-SHA256 keyed by SECRET_KEY. They are short,
so a bare hash would be worth brute-forcing offline if the database leaked;
the key makes that search useless without the secret too. Device tokens are
256 bits of randomness, so a plain SHA-256 is enough, and rotating SECRET_KEY
does not sign every phone out. (It still invalidates Google tokens, iCloud
passwords, and feed links.)
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import logging
import secrets
import time
from datetime import timedelta

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import SessionLocal
from ..models import Device, PairingCode, utcnow

log = logging.getLogger(__name__)

# Unambiguous on a TV across the room: no 0/O, no 1/I.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CODE_LENGTH = 8
PAIRING_TTL = timedelta(minutes=10)
# Shown in the device list. Long enough to tell two phones apart, short enough
# that it is not itself a credential.
_PREFIX_LENGTH = 12
# Rewriting last_used_at on every poll would be a write per widget refresh.
_TOUCH_EVERY = timedelta(minutes=5)

_MODES = ("lan", "local", "token", "off")

# Failed pairing attempts per client address. Single process only — see
# AGENTS.md. A second uvicorn worker would not share this, and would also race
# the sync loops, so that is not a supported deployment.
_FAILS: dict[str, list[float]] = {}
_FAIL_WINDOW = 15 * 60
_FAIL_LIMIT = 8


def auth_mode(settings: Settings | None = None) -> str:
    raw = (settings or get_settings()).auth_mode.strip().lower()
    if raw in _MODES:
        return raw
    log.warning("Unknown AUTH_MODE %r; not trusting any address", raw)
    return "token"


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def hash_code(raw: str) -> str:
    key = get_settings().secret_key.encode()
    return hmac.new(key, raw.encode(), hashlib.sha256).hexdigest()


def new_device_token() -> str:
    return "mantel_" + secrets.token_urlsafe(32)


def new_pairing_code() -> str:
    raw = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))
    return f"{raw[:4]}-{raw[4:]}"


def normalize_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch in _ALPHABET)


def token_prefix(raw: str) -> str:
    return raw[:_PREFIX_LENGTH]


def client_host(request: Request, settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    if settings.auth_trust_proxy:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    if request.client is None:
        return ""
    return request.client.host or ""


def _parse_ip(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    # Docker and dual-stack listeners sometimes hand us an IPv4-mapped address.
    text = host.strip()
    if text.lower().startswith("::ffff:"):
        text = text.split(":", 3)[-1]
    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def _extra_networks(settings: Settings) -> list[ipaddress._BaseNetwork]:
    nets: list[ipaddress._BaseNetwork] = []
    for piece in settings.auth_trusted_cidrs.split(","):
        piece = piece.strip()
        if not piece:
            continue
        try:
            nets.append(ipaddress.ip_network(piece, strict=False))
        except ValueError:
            log.warning("Ignoring unreadable AUTH_TRUSTED_CIDRS entry %r", piece)
    return nets


def network_trusted(host: str, settings: Settings | None = None) -> bool:
    """Whether this source address may call the API with no token.

    `off` trusts everyone. `token` trusts nobody (extra CIDRs still apply, so
    a Tailscale range can be named explicitly). `local` is loopback. `lan`
    adds RFC1918, IPv6 unique-local, and link-local — which is what the Pi
    kiosk looks like from inside the container.
    """
    settings = settings or get_settings()
    mode = auth_mode(settings)
    if mode == "off":
        return True
    ip = _parse_ip(host)
    if ip is not None and any(ip in net for net in _extra_networks(settings)):
        return True
    if ip is None or mode == "token":
        return False
    if ip.is_loopback:
        return True
    if mode == "local":
        return False
    return bool(ip.is_private or ip.is_link_local)


def presented_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
        if token:
            return token
    # <img> and other tags cannot set a header. The wall does not need this;
    # a paired browser does, for screensaver photos. It ends up in access logs.
    query = request.query_params.get("access_token", "").strip()
    return query or None


def token_is_valid(raw: str) -> bool:
    """True when `raw` matches a paired device. Touches last_used_at at most
    every few minutes so a polling screen is not a write storm."""
    digest = hash_token(raw)
    with SessionLocal() as db:
        device = db.scalar(select(Device).where(Device.token_hash == digest))
        if device is None:
            return False
        now = utcnow()
        if device.last_used_at is None or now - device.last_used_at >= _TOUCH_EVERY:
            device.last_used_at = now
            db.commit()
        return True


def too_many_attempts(host: str) -> bool:
    now = time.monotonic()
    recent = [t for t in _FAILS.get(host, []) if now - t < _FAIL_WINDOW]
    _FAILS[host] = recent
    return len(recent) >= _FAIL_LIMIT


def record_failure(host: str) -> None:
    now = time.monotonic()
    recent = [t for t in _FAILS.get(host, []) if now - t < _FAIL_WINDOW]
    recent.append(now)
    _FAILS[host] = recent


def clear_failures() -> None:
    """Tests only. The window is process-global, and cases share a process."""
    _FAILS.clear()


def consume_valid_code(db: Session, normalized: str) -> bool:
    """Mark a matching unused, unexpired code as used. The caller commits."""
    if len(normalized) != _CODE_LENGTH:
        return False
    row = db.scalar(select(PairingCode).where(PairingCode.code_hash == hash_code(normalized)))
    if row is None or row.used_at is not None or row.expires_at <= utcnow():
        return False
    row.used_at = utcnow()
    return True
