# Home control

Mantel's **Home** page controls lights, fans, shades, thermostats, locks, switches and scenes.
It does this through [Home Assistant](https://www.home-assistant.io/) rather than by speaking
to each brand, so anything Home Assistant has can appear on the wall.

## Set up

1. In Home Assistant, add your devices under **Settings → Devices & services** (Lutron Caseta,
   SmartThings, Hue, and so on) and give them **areas**. Mantel's rooms are Home Assistant's areas.
2. In Home Assistant, open your profile → **Security** → **Long-lived access tokens** → **Create
   token**, and copy it. It is shown once.
3. In Mantel, **Settings → Home**: enter the Home Assistant address (for example
   `http://10.0.0.5:8123`) and paste the token. **Test connection** reports what it found.

If Mantel runs in Docker, the address has to be one the *container* can reach. On Docker Desktop,
`http://host.docker.internal:8123` reaches Home Assistant on the same PC.

## Using it

- Tap a tile to switch it. Press and hold, or tap **⋯**, for sliders, a thermostat's target and
  mode, **Add to favorites** and **Hide from Home**. Locks ask before they move.
- Hidden devices are listed in **Settings → Home** and can be shown again there.
- Scenes and scripts are the buttons across the top.
- With a TV remote (`?tv=1`) the D-pad moves between tiles, **OK** switches one, and the **⋯**
  button beside each opens its controls. Left and Right move a slider.

## What Mantel will and won't do

Only these kinds of device are shown and controlled: light, fan, cover, switch, climate, lock,
input_boolean, script and scene. Sensors, buttons and the like never appear. The server
accepts a fixed set of actions (`turn_on`, `turn_off`, `toggle`, `set_level`, `open`, `close`,
`stop`, `activate`, `set_temperature`, `set_hvac_mode`, `lock`, `unlock`) and nothing else; it
is not a pass-through to Home Assistant's service API.

## The token

It is encrypted at rest with `SECRET_KEY`, used only by the server, and never returned by the
API. To change it, paste a new one; to remove it, use **Remove token**.

## API

| Call | |
| --- | --- |
| `GET /api/home` | Rooms, devices and scenes, or a `status` of `not_configured`, `unreachable` or `invalid_token` with a `message` |
| `POST /api/home/entities/{entity_id}/action` | `{"action": "set_level", "value": 40}`; locks also need `"confirm": true` |
| `POST /api/home/test` | `{ok, status, message}` |
| `GET /api/home/live` | Server-sent events: `status`, `state`, `refresh` |
