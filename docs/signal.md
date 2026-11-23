# Family messaging with Signal

Mantel can send notes and doodles through a self-hosted
[signal-cli REST API](https://github.com/bbernhard/signal-cli-rest-api)
container instead of Twilio. The wall never talks to Signal's servers itself, and
pictures are sent as base64 attachments, so nothing needs a public URL.

Use **normal** mode (not `json-rpc`). In normal mode, `GET /v1/receive/{number}`
is a plain HTTP poll, which is how Mantel collects replies.

## Run the container on the Windows PC

Create a data folder next to the Mantel server files so a container rebuild does
not forget the linked device. Then start the API, bound only to localhost:

```powershell
New-Item -ItemType Directory -Force -Path "C:\Users\elhar\Documents\TouchscreenCalendar\mantel-server\signal-cli" | Out-Null

docker run -d --name signal-api --restart unless-stopped `
  -p 127.0.0.1:8081:8080 `
  -v "C:\Users\elhar\Documents\TouchscreenCalendar\mantel-server\signal-cli:/home/.local/share/signal-cli" `
  -e MODE=normal `
  bbernhard/signal-cli-rest-api
```

The volume path inside the container (`/home/.local/share/signal-cli`) is the one
the upstream project documents. `8081` on the host avoids clashing with Mantel on
`8080`. Do not publish `8081` on `0.0.0.0`, and do not set `AUTO_RECEIVE_SCHEDULE`
— Mantel already polls for new messages itself, and a second receiver can steal
them.

Check it with `http://127.0.0.1:8081/v1/about` on the PC. You should see
`"mode": "normal"`.

## How Mantel reaches it

The Mantel container should use this API address in Settings → Messages:

```
http://host.docker.internal:8081
```

That is the default. On Docker Desktop for Windows, `host.docker.internal` is
proxied to the host, including ports bound to `127.0.0.1`, so this pairing works
without putting Signal on the LAN.

If Settings says it cannot reach the API, use a shared Docker network instead
(no host port needed):

```powershell
docker network create mantel-net
docker network connect mantel-net mantel
docker network connect mantel-net signal-api
```

If `signal-api` is not running yet, attach the network when you start it:

```powershell
docker run -d --name signal-api --restart unless-stopped `
  --network mantel-net `
  -v "C:\Users\elhar\Documents\TouchscreenCalendar\mantel-server\signal-cli:/home/.local/share/signal-cli" `
  -e MODE=normal `
  bbernhard/signal-cli-rest-api
```

Then set the API address in Settings to `http://signal-api:8080`.

If Mantel was already running without that network, `docker network connect mantel-net mantel`
is enough — you do not have to recreate the calendar container.

## Link the device

1. In Mantel, open Settings → Messages and choose **Signal**.
2. Confirm the API address, then tap **Link to Signal**.
3. On your phone: Signal → Settings → Linked devices → +, and scan the QR code
   on the wall. The code is fetched once; if you leave and come back, a new one
   is made.
4. When the screen says **Linked**, the account number is filled in for you.
5. Add family cell numbers in Settings → Family if they are not there yet, then
   send a test.

The phone that owns the Signal account has to stay able to come online now and
then — linked devices depend on the primary phone, just like Signal Desktop.

## Switching back to Twilio

The provider choice in Settings → Messages is Twilio or Signal, not both at
once. Threads and saved numbers stay; only the send/receive path changes.
