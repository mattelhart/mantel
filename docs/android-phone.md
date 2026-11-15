# Mantel on an Android phone

A companion for the wall calendar. Today and month, chores and stars, rewards, and lists. It follows the same live stream as the wall and keeps the last copy when the phone cannot reach the server.

The app lives in `apps/android-tv` next to the TV app. Both use the `core` module (the API client, models, live stream, and offline queue) and the `device` module (the Keystore-backed token).

## Install

You need Android 8 or newer. The app is not in the Play Store. Sideload the debug APK.

```bash
cd apps/android-tv
./gradlew :phone:assembleDebug
adb install -r phone/build/outputs/apk/debug/phone-debug.apk
```

The APK is signed with the keystore committed in `apps/android-tv/signing/`. A newer build from any machine installs over this one and keeps the server address and the pairing token. An app that was installed from an older build, signed with a machine-local debug key, has to be uninstalled once first.

Without a computer: copy `phone-debug.apk` onto the phone and open it. Android will ask you to allow installs from that app. Opening an APK that way also replaces an older install when the signature matches and the version code is not lower.

`./gradlew assembleDebug` in that directory also builds the TV app. `./gradlew test` runs the core and phone unit tests. The version code is the git commit count, so the checkout needs its full history. See [apps/android-tv/README.md](../apps/android-tv/README.md).

## Pairing

The phone reaches Mantel over the home Wi-Fi, or over Tailscale or WireGuard. Do not port-forward the server. The app refuses cleartext HTTP to a public IP. It allows cleartext to private addresses (the LAN, and WireGuard's `10.x`), to Tailscale's `100.64.0.0/10` range, and to names such as `familycal.local` or a MagicDNS hostname. HTTPS is allowed anywhere.

1. First launch tries the last address that worked, then `http://familycal.local:8080`. That name is an mDNS hostname, not something Mantel advertises, and a Windows PC running Docker Desktop does not publish it. The hostname check uses a short timeout. If it does not answer, the address box opens with the saved address filled in. A bare address such as `192.168.1.20` is tried on port 8080. The server can be a Raspberry Pi or any other machine on the LAN. See [windows-server.md](windows-server.md) when that machine is a Windows PC.
2. On the home LAN, or on a WireGuard address, `AUTH_MODE=lan` (the default) needs no code.
3. Tailscale addresses are not private. Add `AUTH_TRUSTED_CIDRS=100.64.0.0/10` if those phones should skip pairing. Otherwise pair once.
4. When the server asks for a token, on the wall open **Settings → Devices → Pair a phone**. Scan the QR, or type the 8-character code. The QR is a `mantel://pair` link carrying the server address and the code. The code is single use and expires after 10 minutes. Dashes and case do not matter.
5. The token is encrypted with an Android Keystore key before it is written. Revoke the phone from the wall. The next call asks you to pair again.

**Settings → Forget this server** drops the address and the token so you can start over.

## What it does

- Today and month, colored per person. Tap a person to hide their events.
- Create, edit, and delete events, including a repeat rule (once, daily, weekly on chosen days, monthly, yearly, with an optional end). A series this server expands is edited as a whole series, and the screen says so. One occurrence that Google already expanded is edited on its own. Event edits are not queued: if the phone is offline, the server's copy is kept.
- Chores for each person, for the day you are looking at. A tap checks that occurrence only. Stars are the balance. A check that is waiting can be approved or sent back.
- Rewards spend stars. **Given** or **Send back** finishes a request.
- Lists: open one, check an item, add an item, clear the checked ones.
- `GET /api/live` while the app is open, and a poll about every 60 seconds when the stream is down.
- Offline, the last calendar, chores, and lists stay up, with `Offline, last synced <time>`. A chore check, a reward redeem, and a list tick made then are replayed with the same `request_id` when the phone can reach the server again.
- Dark mode follows the phone, or you can set it under Settings.
- Optional home-screen widget, **Mantel today**, shows the last agenda the app stored. A notification fires when a timed event is about to start. That check runs when the app refreshes, and about every 30 minutes in the background. It is not a push channel from the server.

Chores and rewards are created on the wall. The phone checks them off and spends the stars.

## Limits

- There is no mDNS browse beyond trying `familycal.local`.
- Editing one occurrence of a series that Mantel expands is still not available. The phone edits the whole series, the same way the wall does.
- The widget and the notification use the last successful sync. They do not invent events the phone has never seen.
