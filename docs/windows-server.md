# Running the server on a Windows PC

Mantel is one Docker container. Docker Desktop on a Windows PC can host it. A Raspberry Pi can still be the wall display later, or take over as the server, without changing the TV or phone apps.

The Windows app in [windows.md](windows.md) is only a window onto this server. It is not the server.

## Start

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and leave it running.

From a checkout of this repo, in PowerShell:

```powershell
copy .env.example .env
docker compose up -d --build
```

Put a long random `SECRET_KEY` in `.env` before anyone links a Google or iCloud account. The comment in `.env.example` shows one way to generate it.

Or use the published image, which does not need a checkout. Generate a secret however you like and paste it in place of the placeholder:

```powershell
docker run -d --name mantel -p 8080:8080 `
  -v mantel-data:/data `
  -e SECRET_KEY="paste-a-long-random-string" `
  ghcr.io/heyitsmiike101/mantel:latest
```

The container listens on port **8080**.

On the PC itself, open <http://localhost:8080>.

Other devices on the house Wi-Fi use the PC's LAN address, for example `http://192.168.1.20:8080`. Take that address from `ipconfig` on the Wi-Fi adapter. A `172.x` address belongs to Docker, and the rest of the house cannot route to it.

Windows does not advertise `familycal.local`. The TV and phone apps try that name, then ask for an address. Type the LAN address. A bare address is tried on port 8080. The next launch tries the address that worked before it tries the name again.

## Firewall

Allow inbound TCP **8080** for the **Private** profile only, and limit the remote address to the **local subnet**.

1. Windows Security → Firewall & network protection → Advanced settings.
2. Inbound Rules → New Rule → Port → TCP → `8080` → Allow the connection.
3. Profile: check **Private**. Leave Domain and Public unchecked.
4. Name it Mantel.
5. Open the rule → Scope → Remote IP address → These IP addresses → the house subnet (Local subnet, or for example `192.168.1.0/24`).

Docker Desktop may ask to allow its backend the first time the port is published. Allow it on private networks.

Confirm the PC's network is Private: Settings → Network & internet → the connection → Network profile → Private.

## Do not port-forward

Do not forward port 8080 on the router, and do not open it on the Public firewall profile. The calendar is for the house. A port forward puts it on the internet.

Phones and TVs that leave home should use **Tailscale** or **WireGuard** on this PC and on the device. The app's address is then the VPN address. Tailscale's range is not a private LAN, so those phones pair once, or you can set `AUTH_TRUSTED_CIDRS=100.64.0.0/10` if those addresses should skip pairing. See [authentication.md](authentication.md).

Keep the PC awake while anyone might look at the wall. Sleep hides the server. The database stays in the `mantel-data` Docker volume. Do not put that volume on OneDrive.
