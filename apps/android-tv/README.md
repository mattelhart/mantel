# Mantel for Google TV

A remote-only calendar for the living room. D-pad, select, and Back. The
`core` module is plain Kotlin — HTTP, dates, and the chore rules — so a future
phone app can depend on it without taking the TV screens.

The look is a bright board: warm paper, big type, and a thick dark ring on
whatever has focus.

## Build

You need JDK 17 and the Android SDK (compile SDK 35, build-tools 35).

```bash
cd apps/android-tv
export ANDROID_HOME="$ANDROID_SDK_ROOT"   # or wherever the SDK lives
./gradlew assembleDebug test
```

The debug APK is

```text
apps/android-tv/app/build/outputs/apk/debug/app-debug.apk
```

## Sideload onto a Google TV

1. On the TV: **Settings → System → About**. Click the Android TV OS build row
   until developer options turn on.
2. **Settings → System → Developer options**. Turn on **USB debugging** and
   **Network debugging** (the name is sometimes **ADB debugging**).
3. From a computer on the same network:

```bash
adb connect <tv-ip>:5555
adb install -r apps/android-tv/app/build/outputs/apk/debug/app-debug.apk
```

If `adb connect` asks you to allow the computer, accept the prompt on the TV.

Without a computer: install **Downloader** or **Send Files to TV** from the Play
Store on the TV, copy the APK to the TV, and open it. You may have to allow
installs from that app under security settings.

## Point it at the Pi

The first launch tries `http://familycal.local:8080`. That name is the Pi's
mDNS hostname (Avahi), not something Mantel advertises. If the Pi is not named
`familycal`, enter its address with the on-screen keyboard, for example
`192.168.1.20`. A bare address is tried on port 8080.

If the TV is off the trusted network, or the server is in `AUTH_MODE=token`,
the app asks for a pairing code. On the wall: **Settings → Devices → Pair a
phone**. Type the code. The token is stored with an Android Keystore key and
an encrypted DataStore entry.

A TV on the home LAN, or on WireGuard (a private `10.x` address), does not need
a code while `AUTH_MODE=lan`.

**Server** in the top row forgets the address and the token so you can start over.

## What it does

- Agenda, week, and month. Left and right move the day, week, or month. Select
  opens an event. Back leaves it.
- Add, edit, and delete a simple event: title (TV keyboard), all-day or a time,
  person, calendar. A repeating series is edited as a whole, and the screen says so.
- Lists: open one, select an item to check it, add an item with the keyboard.
- Chores for each person, with their color and stars. Select checks today's
  occurrence only. Approve or send back a chore that is waiting. Rewards spend
  stars; **Given** or **Send back** finishes the request.
- Follows `GET /api/live` (the same stream as the wall) and refetches only what
  changed. If the stream drops, it polls about every 60 seconds. Offline, the
  last calendar, lists and chores stay up with `Offline, last synced <time>`.
  A chore check or list tick made then is replayed, with the same `request_id`,
  when the TV can reach the Pi again.
- Optional screensaver: in the TV's screensaver settings, pick **Mantel today**.
  It shows today's agenda.

## API notes

Chores and rewards are part of this branch. Each day is its own completion.
Stars are the sum of a ledger. Complete and redeem take a `request_id` so a
retry does not award or spend twice. A family member does not need a Google or
iCloud account.

Gaps:

- The server does not advertise itself over mDNS. Discovery is the hostname
  `familycal.local`.
- Editing one occurrence of a series is still not available. The TV edits the
  whole series when the event has a recurrence rule.
- Weekly and one-off chores are created on the wall. The TV checks today's list
  and redeems rewards.
- There is no push channel. The app polls, the same way the wall does.
