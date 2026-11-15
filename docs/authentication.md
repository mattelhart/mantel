# Authentication

The wall display does not log in. A phone that is not on the home network does.
This is the contract the iOS and Android apps should implement. The same rules
are on each route in `/api/docs` and in `/api/openapi.json` (security scheme
`DeviceToken`).

## What is protected

Every `/api` route requires either a trusted source address or a device token,
except:

| Route | Why it stays open |
| --- | --- |
| `GET /api/health` | Liveness, including the Docker healthcheck |
| `GET /api/version` | The kiosk polls this to reload after a deploy. No family data |
| `GET /api/auth/status` | Tells a client whether *this* address needs a token |
| `POST /api/auth/pair` | The phone has no token yet. The pairing code is the credential |
| `GET /api/accounts/google/callback` | Google redirects the browser here and cannot attach a header |
| `GET /api/feeds/*.ics?token=` | Subscriptions already carry their own token. `GET /api/feeds/token`, which reveals it, is protected |
| `GET /api/openapi.json`, `/api/docs`, `/api/redoc`, `/api/ai-guide` | The contract itself |

The HTML, CSS and JavaScript of the wall UI are not under `/api`. They are
public. The data they request is not.

## The wall display

`AUTH_MODE` decides which addresses skip the token. The default is `lan`.

| Mode | Who gets in with no token |
| --- | --- |
| `lan` (default) | Loopback, link-local, and private addresses (RFC1918 and IPv6 unique-local). That is the Pi, the rest of the house, and — this is the important one — the browser on the Pi talking to a published Docker port. From inside the container that connection comes from the bridge gateway (`172.17.0.1` or similar), which is a private address, not `127.0.0.1`. |
| `local` | Loopback only. Use this with host networking. Docker port publishing will lock the kiosk out, because the container does not see `127.0.0.1`. |
| `token` | Nobody. Every caller, including the wall, needs a device token. The browser shows a pairing screen. |
| `off` | Everyone. The historical open API. |

`AUTH_TRUSTED_CIDRS` adds networks on top of the mode. Tailscale's range is
not private, so a tailnet that should stay login-free is:

```bash
AUTH_TRUSTED_CIDRS=100.64.0.0/10
```

`AUTH_TRUST_PROXY=true` takes the client address from the first
`X-Forwarded-For` hop. Leave it off unless a reverse proxy in front of Mantel
overwrites that header. A client that can set the header otherwise chooses its
own address.

The Docker image also sets `FORWARDED_ALLOW_IPS` empty. Uvicorn's own default
is to trust `X-Forwarded-For` from loopback, which would let anything that can
connect to 127.0.0.1 pretend to be on the LAN. With it empty, the address
`AUTH_MODE` sees is the TCP peer: the Docker bridge for the Pi's browser, a
LAN address for a phone on the wifi. If a reverse proxy sits in front and you
want the real client address, set `FORWARDED_ALLOW_IPS` to that proxy's
address only.

The kiosk needs nothing stored in the browser. If it does send a stale
`Authorization` header, and its address is trusted, the request is still
allowed. A bad token must not lock the wall out of itself.

## Pairing a phone

1. On the wall, Settings → Devices → **Pair a phone**.
   `POST /api/auth/pairing-codes?base_url=http://192.168.1.20:8080`
   (the wall's own origin). This route is protected: the internet cannot mint
   codes.

2. The response:

```json
{
  "code": "K7NQ-4RMP",
  "expires_at": "2026-11-15T02:50:00Z",
  "qr_payload": "mantel://pair?v=1&base=http%3A%2F%2F192.168.1.20%3A8080&code=K7NQ-4RMP",
  "qr_svg": "<svg ...>"
}
```

   The code is 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I),
   shown with a dash. It is single use and expires after 10 minutes. Showing a
   new code invalidates the previous one. Only the HMAC-SHA256 of the code,
   keyed by `SECRET_KEY`, is stored.

3. The phone parses `qr_payload`. `base` is the server origin. `code` is the
   pairing code. Then:

```http
POST /api/auth/pair
Content-Type: application/json

{ "code": "K7NQ-4RMP", "name": "Matt's iPhone" }
```

   Dashes and case do not matter. The response is `201`:

```json
{
  "token": "mantel_…",
  "token_type": "bearer",
  "device": { "id": 1, "name": "Matt's iPhone", "token_prefix": "mantel_ab12c", "created_at": "…", "last_used_at": null }
}
```

   `token` is shown once. The server stores SHA-256 of it, plus the prefix so
   the settings list can tell two phones apart. Wrong codes are rate limited
   per address (8 failures, then `429` for 15 minutes).

4. Every later request:

```http
Authorization: Bearer mantel_…
```

   `<img>` and other tags cannot set a header. Those URLs (screensaver photos)
   also accept `?access_token=`. Prefer the header: the query form ends up in
   access logs.

5. Revoke from the wall, or with a token that is still valid:

```http
DELETE /api/auth/devices/1
```

   The row is deleted. The phone's next call is `401` until it pairs again.

`GET /api/auth/devices` lists live devices (`id`, `name`, `token_prefix`,
`created_at`, `last_used_at`). It does not return tokens. `last_used_at` moves
at most every five minutes.

`GET /api/auth/status` is public and reports, for the address that asked:

```json
{ "auth_mode": "lan", "network_trusted": false, "authorization_required": true }
```

A browser that is not trusted shows a code prompt and calls `POST /api/auth/pair`
itself, then keeps the token in `localStorage`. The wall never sees that prompt.

## Errors

Failures use the same envelope as the rest of the API:

```json
{ "error": { "code": "unauthorized", "message": "…" } }
```

`401` means the code was wrong or expired, or the bearer token is unknown and
the address is not trusted. A `401` carries `WWW-Authenticate: Bearer realm="mantel"`.
`429` / `rate_limited` means too many pairing attempts. `404` on revoke means
that device is already gone.

## Upgrading an existing database

No manual migration. Startup creates the `devices` and `pairing_codes` tables
the same way it adds columns. Existing calendars, events and settings are
untouched. A deployment that was open on the LAN stays open on the LAN. What
changes is that a port-forward to the internet no longer serves the calendar
to anyone who finds it.

Rotating `SECRET_KEY` still forces Google and iCloud accounts to reconnect and
changes the feed links. It does not revoke device tokens. It does invalidate
pairing codes that are still on screen, which expire in ten minutes anyway.

## Phones away from home

Keep the server on a machine that stays on: the Pi, or a PC that does not sleep
while anyone might look at the wall. The database stays on that machine's disk.
Do not put `family.db` in a live sync folder.

A phone on WireGuard is already on a private address (`10.x`, `192.168.x`, or
`172.16`–`172.31`), so `AUTH_MODE=lan` treats it like a phone on the home Wi-Fi.
Connect the tunnel and open `http://<that-machine>:8080`. No `AUTH_TRUSTED_CIDRS`
entry, and no port forward. Pairing is only for when the tunnel is down.
