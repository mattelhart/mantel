#!/usr/bin/env python3
"""Fetch UniFi Network + Protect status. Never prints the API key."""
from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

KEY_PATHS = [
    Path(r"C:\Users\elhar\Documents\TouchscreenCalendar\secrets\unifi.key"),
    Path("/etc/mantel-udm/unifi.key"),
    Path("/workspace/udm-monitor/.unifi.key"),  # never commit
]
BASE = "https://10.0.0.1"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("udm-status.json")


def load_key() -> str:
    for p in KEY_PATHS:
        if p.is_file():
            key = p.read_text(encoding="utf-8").strip()
            if key:
                return key
    raise SystemExit("UniFi API key file not found")


def fetch(key: str, path: str) -> tuple[int, object]:
    url = BASE + path
    req = urllib.request.Request(
        url,
        headers={
            "X-API-KEY": key,
            "Accept": "application/json",
        },
        method="GET",
    )
    ctx = ssl._create_unverified_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=12) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, {"_non_json": body[:500], "_len": len(body)}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        snippet = body[:500]
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"_non_json": snippet}
        return e.code, parsed
    except Exception as e:
        return 0, {"_error": type(e).__name__, "_msg": str(e)}


def main() -> None:
    key = load_key()
    results: dict[str, object] = {"base": BASE, "endpoints": {}}
    # Probe both local Integration API prefixes
    probes = [
        "/proxy/network/integration/v1/sites",
        "/integration/v1/sites",
        "/proxy/protect/integration/v1/cameras",
        "/proxy/protect/integration/v1/sensors",
    ]
    for path in probes:
        code, data = fetch(key, path)
        results["endpoints"][path] = {"status": code, "data": data}

    # If sites worked, fetch devices/clients/stats
    sites = None
    site_prefix = None
    for prefix in ("/proxy/network/integration/v1", "/integration/v1"):
        entry = results["endpoints"].get(prefix + "/sites", {})
        if entry.get("status") == 200:
            site_prefix = prefix
            sites = entry.get("data")
            break

    site_id = None
    if isinstance(sites, dict):
        data = sites.get("data") or sites.get("sites") or []
        if data:
            site_id = data[0].get("id")
            results["site"] = data[0]
    elif isinstance(sites, list) and sites:
        site_id = sites[0].get("id")
        results["site"] = sites[0]

    if site_id and site_prefix:
        more = [
            f"{site_prefix}/sites/{site_id}/devices?limit=200",
            f"{site_prefix}/sites/{site_id}/clients?limit=200",
        ]
        for path in more:
            code, data = fetch(key, path)
            results["endpoints"][path] = {"status": code, "data": data}

        # Latest stats for each device (cap to 15)
        devices = results["endpoints"].get(
            f"{site_prefix}/sites/{site_id}/devices?limit=200", {}
        ).get("data")
        device_list = []
        if isinstance(devices, dict):
            device_list = devices.get("data") or []
        elif isinstance(devices, list):
            device_list = devices
        results["device_stats"] = {}
        for dev in device_list[:15]:
            did = dev.get("id")
            if not did:
                continue
            path = f"{site_prefix}/sites/{site_id}/devices/{did}/statistics/latest"
            code, data = fetch(key, path)
            results["device_stats"][dev.get("name") or did] = {
                "id": did,
                "type": dev.get("type"),
                "model": dev.get("model"),
                "state": dev.get("state"),
                "status": code,
                "data": data,
            }

    OUT.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    # Summary only — never include the key
    print("wrote", str(OUT))
    for path, entry in results["endpoints"].items():
        status = entry.get("status")
        data = entry.get("data")
        n = ""
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], list):
            n = f" items={len(data['data'])} total={data.get('totalCount', '')}"
        elif isinstance(data, list):
            n = f" items={len(data)}"
        elif isinstance(data, dict) and data.get("_error"):
            n = f" error={data.get('_error')}"
        print(f"  {status} {path}{n}")


if __name__ == "__main__":
    main()
