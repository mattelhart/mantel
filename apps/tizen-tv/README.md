# Mantel for Samsung Tizen TV

TV web application intended for the Samsung CU7000 family. This is a hosted
client: the installed shell loads the shared Mantel interface from your desktop
server, so calendar, chore, reward, and list changes use the same APIs and data.
It is not an Android APK and cannot be installed with ADB.

The shell remembers the server address, handles connection failures and wake,
and validates the origin and source of messages from the calendar frame.
The server's `?tv=1` mode adds directional focus navigation, a visible focus ring,
dialog focus containment, and Samsung Back handling. Arrow navigation does not
intercept text editing or native selection controls. Back leaves a field, then
closes the event dialog, or returns to the connection screen. Use Select/Enter
to activate a focused control. A keyboard and mouse also work.

## Current status

Source and browser build are available. A signed package and real CU7000 testing
require the Samsung TV SDK, a Samsung certificate including the TV DUID, and
Developer Mode. Browser checks do not establish device compatibility. TV virtual
keyboard behavior, wake/resume, media uploads, and all editing flows must be
verified on the device. Provider account login is best completed on the desktop.

## Build and install

1. Build and deploy the repository's frontend to the Mantel server first.
2. Install Tizen Studio with Samsung TV and Samsung Certificate extensions.
3. On the TV, open Apps / App Settings and enter `12345`. Enable Developer Mode,
   set Host PC IP to the development PC, and restart the TV.
4. Connect through Device Manager to the TV, create a Samsung certificate profile
   that includes its DUID, and use **Permit to install applications** as needed.
5. Run `./package.ps1 -CertificateProfile YOUR_PROFILE`. This produces a signed
   `.wgt` under `build/`. Do not commit certificates or private keys.
6. Install/run through Tizen Studio, or use the SDK's `tizen install` and `tizen run`
   commands with the target name returned by Device Manager. App ID is
   `MantelTV01.Mantel`.

Keep the Mantel server running and enter its LAN address in the TV app.

Preview the shell with `python -m http.server 8091 --bind 127.0.0.1 --directory apps/tizen-tv`
from the repository root. Open `http://127.0.0.1:8091` in a browser. This does not
emulate Samsung APIs. No Samsung SDK is needed for a browser preview.

Official installation and signing instructions:
- https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html
- https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html
