# Mantel Calendar for Windows

A window around the calendar you already run. The app does not contain a second copy of the interface. It opens the Mantel server in WebView2, so pairing, live updates, and offline mode are the web app's.

To run the server itself on this PC, see [windows-server.md](windows-server.md). This page is only the window.

Windows 11 already includes WebView2. The installer is current-user only: it does not ask for an administrator.

## First launch

The address starts as `http://localhost:8080`, which is this PC's Docker container. **Test connection** calls `GET /api/health`. **Open calendar** saves the address and loads it.

A bare address such as `10.0.15.178` is tried on port 8080. `https://` keeps the port you typed. The next launch opens the saved address directly, including when the server is down, so the web app can show its last calendar.

To point it at another machine later: **File → Change server…**, enter that machine's address, and test again.

## Pairing

On the same PC, or on a trusted LAN address, `AUTH_MODE=lan` needs no code. If this window is somewhere the server does not trust, the calendar shows its own pairing screen. On the wall: **Settings → Devices → Pair a phone**. The token stays in the web app's storage for this window.

## The window

Size, position, maximized, and full screen are remembered. **F11** toggles full screen. **File → Full screen** does the same. **File → Quit** closes it. F11 still leaves full screen when the menu bar is hidden.

## Install

The build is a GitHub Actions workflow, [`.github/workflows/desktop.yml`](../.github/workflows/desktop.yml). It runs on a Windows runner because the installer is an NSIS executable.

1. On GitHub, open **Actions → Windows desktop**.
2. **Run workflow**, and choose the branch you want built.
3. When the job is green, open that run and download the artifact **mantel-calendar-windows**.
4. Inside the zip:
   - `mantel-calendar-setup.exe` installs Mantel Calendar for the current user.
   - `mantel-calendar.exe` is the same program with no installer. Put it anywhere and run it.

The workflow also runs on a pull request that changes `apps/desktop`. The artifact is on that run's page, under Artifacts.

From a checkout on Windows, the same build is:

```bash
cd apps/desktop
cargo install tauri-cli --version "^2"
cargo tauri build --bundles nsis
```

The installer is written under `src-tauri/target/release/bundle/nsis/`.
