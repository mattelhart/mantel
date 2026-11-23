# Mantel for iPhone

A native SwiftUI companion for the family wall calendar. It talks to the same FastAPI server as the Android phone app: calendar, chores, lists, meals, photos, family members, home lights, and messages (text, quick replies, and doodles).

The app lives in `apps/ios`. There are no paid services and no App Store account is required to install it on your own iPhone.

## Requirements

- A Mac with Xcode 15 or later (iOS 17 SDK)
- An iPhone running iOS 17 or later, or the Simulator
- The Mantel server on the LAN or over WireGuard (plain HTTP on a private address is expected). Do not port-forward the server.

A free Apple ID is enough to sign and install the app on a personal iPhone. A paid Developer Program membership is not needed.

## Open the project

The repository already has `Mantel.xcodeproj`, so you can open it directly:

```bash
open apps/ios/Mantel.xcodeproj
```

Or in Xcode: **File → Open…** and choose `apps/ios/Mantel.xcodeproj`.

If you prefer to regenerate the project from `project.yml`, install [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`) and run:

```bash
cd apps/ios
xcodegen generate
open Mantel.xcodeproj
```

## Signing (free Apple ID)

1. Select the **Mantel** target, then the **Signing & Capabilities** tab.
2. Check **Automatically manage signing**.
3. Under **Team**, choose **Add an Account…** if needed, sign in with your Apple ID, and pick the **Personal Team**.
4. Leave the bundle identifier as `com.mattelhart.mantel`. If Xcode says the identifier is taken on that team, append your initials, for example `com.mattelhart.mantel.me`.

Xcode may ask you to trust the developer certificate on the phone: **Settings → General → VPN & Device Management**.

## Run on an iPhone

1. Plug the iPhone in (or enable wireless debugging once it has been paired).
2. Unlock it and trust the computer if asked.
3. In Xcode's scheme menu, choose the iPhone (not "Any iOS Device" if you want to run immediately).
4. Press **Run** (⌘R).

The first launch asks for Local Network access so the app can reach the calendar on the LAN. Camera access is only used if you scan the pairing QR.

To run the unit tests (server address, pairing codes, recurrence, live-stream parsing): **Product → Test** (⌘U).

## Connect to Mantel

The phone reaches Mantel over home Wi-Fi or WireGuard. It refuses cleartext HTTP to a public IP. It allows HTTP to private addresses (the LAN, and WireGuard's `10.x`), to Tailscale's `100.64.0.0/10` range, and to names such as `familycal.local`. HTTPS is allowed anywhere.

1. First launch tries the last address that worked, then `http://familycal.local:8080`. If neither answers, type the address (for example `10.0.15.178`). A bare IP is tried on port 8080.
2. On the home LAN, or on a WireGuard address, `AUTH_MODE=lan` (the default) needs no code.
3. When the server asks for a token, on the wall open **Settings → Devices → Pair a phone**. Scan the QR, or type the 8-character code. The QR is a `mantel://pair` link carrying the server address and the code. The code is single use and expires after 10 minutes. Dashes and case do not matter.
4. The token is stored in the iPhone Keychain. Revoke the phone from the wall and the next call asks you to pair again. **Settings → Forget this server** drops the address and the token so you can start over.

You never have to restart the app to recover from a drop: **Back** is always on screen, and a friendly banner appears when the server can't be reached. The last calendar, chores, lists, and messages stay visible until the server answers again.

## What it does

- **Home** with large tiles for Calendar, Messages, Chores, Lists, Rewards, and Draw, plus Meals, Photos, Family, Lights, Show on TV, and Pair TV.
- **Calendar** with Day, Week, and Month views. Tap a person to hide their events. Create, edit, and delete events, including a repeat rule (once, daily, weekly on chosen days, monthly, yearly). A series this server expands is edited as a whole series. One occurrence that Google already expanded is edited on its own.
- **Messages** only list family members who have a phone number. Numbers that aren't a family member are hidden. Open a conversation to send a text, tap a big quick-reply ("Dinner's ready", "Call me", "On my way?"), or tap **Draw** for a full-screen doodle (Apple Pencil or a finger). Send uploads a PNG as `media_base64`, the same payload the wall uses.
- **Chores** for the day you are looking at, with stars, approvals, and rewards.
- **Lists**: open one, check an item, add an item, clear the checked ones.
- **Meals**, **Photos** (screensaver pictures), and **Family** (name, color, emoji, phone number).
- **Lights** talks to Home Assistant through the Mantel server. The token is stored on the server, never shown again, and is not kept on the phone after you save it.
- **Pair a TV** mints a one-time code the TV can type. **Show on TV** switches a connected display.
- Live updates over `GET /api/live` while the app is open, and a poll about every 60 seconds if the stream is down.

## What it does not do yet

- No home-screen widget or upcoming-event notification (the Android app has both).
- No queued writes while completely offline: a chore check or list tick made then is retried by refreshing once the server is back, but the app does not keep a durable outbox.
- There is no mDNS browse beyond trying `familycal.local`.

## Project layout

```
apps/ios/
  Mantel.xcodeproj/     Open this in Xcode
  project.yml           XcodeGen description of the same project
  README.md
  Mantel/               SwiftUI app (iOS 17+, bundle id com.mattelhart.mantel)
  MantelTests/          Unit tests for pairing, addresses, and recurrence
```

The pairing scheme is documented in [docs/authentication.md](../../docs/authentication.md). The Android phone app, which this one mirrors, is in [docs/android-phone.md](../../docs/android-phone.md).
