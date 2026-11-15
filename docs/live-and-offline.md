# Live updates and offline mode

Mantel used to refresh by asking again every minute. A chore tap on one screen
could sit unseen on the others until that minute was up, and a dead network
left the wall showing whatever it had last fetched, with no way to keep a tap
that happened in the meantime.

Two mechanisms now sit on top of that. Neither needs a service outside the
container, and both assume one process — the same limit as the sync loops.

## The change stream

`GET /api/live` is Server-Sent Events.

```
id: 14
event: change
data: {"topics":["chores","rewards"],"at":"2026-11-15T19:02:00Z"}

id: 14
event: hello
data: {"id":14}

event: resync
data: {"reason":"gap"}
```

A `change` names the areas a commit touched: `events`, `calendars`, `sync`,
`accounts`, `users`, `settings`, `lists`, `chores`, `rewards`, `widgets`,
`photos`. The screen refetches those and leaves the rest. Rewards are drawn
on the chore board, so that topic refetches chores. A Google or iCloud pull
commits through the same path, so a phone edit shows up with the pull rather
than on the next poll.

Commits that land within a quarter of a second become one notice. A pull of
several calendars is one refetch, not one per event.

`hello` is the id to remember. On reconnect, send it as `Last-Event-ID`. The
server replays what you missed. `resync` means that id is gone — the process
restarted, or more commits happened than the buffer kept (the last 200
notices). Refetch everything, then keep the new id from the `hello` that
follows.

A comment line (`: keepalive`) arrives about every 15 seconds. That is what
stops a proxy from deciding the connection is idle. `X-Accel-Buffering: no`
is set for the same reason.

### Auth

The stream is an ordinary protected GET. `AUTH_MODE=lan` (the default) lets
the wall and the rest of the house open it with no token, including the
browser on the Pi, which Docker presents as a private address. A phone or TV
off that network sends `Authorization: Bearer`, the same device token as
every other call. `?access_token=` works too, for a client that cannot set a
header; prefer the header. An address that is neither trusted nor holding a
token gets `401`.

The web app uses `fetch` so it can send the header. It reconnects with
backoff (1s, 2s, 4s, … up to 30s, plus a short random delay so a restarted
server is not hit by every screen at once). While the stream is up, the
family data is not polled. While it is down, one timer refetches about every
60 seconds — the old cadence, as a fallback. A gap (`resync`) waits a
fraction of a second before refetching, for the same reason.

The TV app and the Android phone app use the client in `apps/android-tv/core`.
Both call `MantelClient.listen` the same way. The phone install notes are in
[android-phone.md](android-phone.md). Mantel Calendar for Windows is a window
around this web app, so it uses the same stream and the same offline cache.
Install notes are in [windows.md](windows.md).

## Offline

The wall stores the last successful calendar, chores (including rewards),
lists, settings and dashboard in IndexedDB, and the service worker still
answers those GETs from its cache when `fetch` throws. The banner is
`Offline, last synced <time>`. The time is the last response that actually
came from the server, not from that cache.

These taps are queued and drawn immediately, then sent in order when anything
reaches the server again:

| Tap | Why a replay is safe |
| --- | --- |
| Check or uncheck a chore | The same `request_id` is sent again. The server returns the original result and does not award or remove stars twice. |
| Approve or send back a check | Approving an already-approved row does not grant the stars again. Sending back a row that is already gone is a 404 and the tap is dropped. |
| Redeem a reward | Same `request_id` rule as a chore check. A second redeem of a reward that is still waiting also returns the open request. |
| Tick a list item | The request sets `checked` to a value, it does not toggle. Sending it again leaves the item where the tap put it. |

Anything the server refuses (the chore was deleted, the stars were not
enough) is dropped and the screen refetches. A dead network stops the queue
so a later tap cannot overtake one the server has not seen.

**Event create, edit and delete are not queued.** A half-applied event would
fight the next Google or iCloud pull. If the wall cannot reach the server,
the edit is not saved and the message says so. When the link returns, the
server's events are what get drawn.

The TV keeps the same snapshot in its app files and shows the same offline
line. A chore check, a reward redeem and a list tick made while it cannot
reach the server are replayed with the same `request_id` once it can.
