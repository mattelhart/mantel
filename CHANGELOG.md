# Changelog

## Backlog

Known gaps, deliberately not built yet. The README points here, so this is the list.

**Tapping the all-day strip does nothing.** Every other empty space on a calendar starts an
event at the time you tapped -- an hour slot in the time-grid views, anywhere in a day cell in
month view. The all-day band across the top of a day column is the one part that doesn't, so
creating an all-day event still means opening the picker and toggling "All day". The band only
renders when a day already has an all-day event, so it isn't a dead zone people hit by
accident; it's an inconsistency rather than a trap.

**Editing one occurrence of a repeating series.** Changing a repeating event changes the whole
series, on both Google and iCloud. Cancelling a single iCloud occurrence does work. The
transport supports more than the UI exposes.

**Drag to move an event** between times or days.

**Serving CalDAV.** Mantel is now a CalDAV *client* (that is how iCloud sync works), but it does
not act as a CalDAV *server*. Phones subscribe by read-only `.ics` feed instead, which is why
they cannot write back.

**Chores and rewards**, and **meal planning** -- both frequently asked for, neither started.

## Unreleased

- **Send a doodle to a phone.** The Doodle pad has a **Send to…** button that texts the current drawing to one or more family members who have a saved number. The Messages list has a prominent **Send doodle** button that opens the same canvas, then the same picker, so you can draw first and choose recipients after. People without a number are visible but not selectable. If Twilio is not set up yet, the buttons still appear and point you to Settings. After a send, the wall confirms and offers **Open thread**. An inbound picture in a thread also has **Open in Doodles**, which loads the picture onto the pad so you can draw on it and reply.

- **Family messages.** A new **Messages** page on the wall sends notes and doodles to a family member's phone as a regular SMS or MMS through Twilio, and shows their replies on the wall. Replies are collected by polling (no public webhook), so the server can stay on the home LAN. Twilio credentials are entered in Settings → Messages and stored sealed, like the Home Assistant token; they are never returned to a browser. Family members can have an optional phone number in Settings → Family. Doodles are uploaded to Twilio's Media Content Service so the picture can be sent without exposing the Mantel server. Unknown inbound numbers appear in an Unknown thread and are never auto-replied to.

- **Games.** A new **Games** page on the wall, the TV and phones, with large cards for 2048, Memory match, Minesweeper, tic-tac-toe and a doodle pad. The first three are vendored (MIT) and run same-origin in an iframe with a large Back button, so they work offline and never load a third-party host. Tic-tac-toe is native (two players, or a short game against the wall). The doodle pad is a native canvas with colours, brush size, undo and clear. Swipe and drag games keep a left gutter so a swipe from the edge of the Pi still goes back.

- **Cameras, phase 1.** A **Cameras** page shows a snapshot grid from the UniFi Protect Integration API. Snapshots refresh every three seconds while the page is visible and pause when the tab is hidden; tapping a tile opens a full-screen view that refreshes about once a second, with Back. Disconnected cameras are greyed and labelled. The server reads the API key from the file at `UNIFI_PROTECT_KEY_FILE` (the feature reports "not configured" until that is set), talks to `UNIFI_PROTECT_URL` (default `https://10.0.0.1/proxy/protect/integration`), caches snapshots for about two seconds, and never logs or returns the key.

- **Side-menu focus rings stay inside the rail.** The rounded outline around the selected or focused item (keyboard, mouse, or a TV remote) no longer clips at the left edge or overlaps the items above and below it, in Airy, the other themes, and `?tv=1`. The Android TV side menu gets the same treatment.

- **Bigger side menu on the wall and TVs.** In landscape (the Pi kiosk, `?tv=1`, the Android TV app) the side-menu labels are about 20% larger and the icons grow with them. The phone's bottom bar is unchanged.

- **Phone app fixes.** System Back now returns to the Home tab before leaving the app; text fields stay above the keyboard; the family home buttons wrap instead of squeezing "Pair TV"; rotating keeps the page you were on; landscape content stays clear of the camera cutout. The TV app is now labelled **Mantel TV** so it can't be mistaken for the phone app.

- **Phone app: pair a TV and set up home control.** Settings → Pair a TV shows a one-time code (and a QR) so a paired phone can pair a TV. Settings → Home control takes the Home Assistant address and token (masked, saved on the server, never echoed back), tests the connection, and opens a Lights page. The wall's Devices tab gains a Pair a TV button.

**Home control.** A new **Home** page controls lights, fans, shades, thermostats, locks, switches and scenes through Home Assistant, which already speaks Lutron Caseta, SmartThings and most other brands. Devices are grouped by the rooms (areas) set in Home Assistant, with scenes and scripts as a row of buttons on top. Tap a tile to switch it, press and hold (or tap the small **⋯**) for a brightness, speed or position slider, a thermostat's target and mode, **Add to favorites** and **Hide from Home**. Locks always ask first, and the server refuses a lock command that wasn't confirmed. Changes made at a wall switch or in the Home Assistant app appear on the page within a second, relayed over a server-sent stream; the connection to Home Assistant is opened only while a Home page is open. The page works from the D-pad in TV mode and is in the side navigation for the wall, the TV and phones.

**Settings → Home** holds the Home Assistant address and token, a **Test connection** button that says exactly what is wrong (can't reach it, token rejected, nothing set up), and a checklist of what to show. The token is encrypted at rest, is never sent back to any browser (the page only learns whether one is saved), and the older Sharing tab no longer duplicates the address and token fields. Favorites and hidden devices are the `home_favorites` and `home_hidden` settings. API: `GET /api/home`, `POST /api/home/entities/{id}/action`, `POST /api/home/test`, `GET /api/home/live`. New dependency: `websockets`.

**Pairing QR draws again, and the phone app handles the link better.** The wall's pairing QR showed as a broken image because the server sent an SVG without its `xmlns` declaration, which an `<img>` will not draw. The server now sends a complete SVG (namespace, a viewBox, a solid white background and a four-module quiet zone, so it scans on every theme) and the page adds the namespace itself if a server ever omits it. The QR is bigger on the wall (240px) and the page warns if it is open as `localhost`, which a phone cannot reach. In the phone app, opening a `mantel://pair` link at launch no longer races the start-up check of the saved server (which could put the address screen back or save the old address), and Android re-delivering the same link after a rotation no longer fails with "already used" and sends a paired phone back to the code screen. The TV's pairing screen now names the wall's **Pair a TV** button and says the dash in the code is optional.

**Home Control: tight rooms and drag and drop.** The Home page is now called Home Control (the menu still says Home). Rooms pack tightly like a masonry wall: a short room slides up under another short room instead of waiting beside a tall one, in the order the family arranged them, and the packing recalculates as the screen is resized or a room's height changes. A "wide" room takes two columns and the others fill in beside it. In Edit mode you now drag: grab a room, device or scene chip by its ⠿ handle (or press and hold anywhere on it on a touchscreen; a mouse can also drag the card itself), and the rest reflow around a dashed placeholder while the card follows your finger, scrolling the page near the top and bottom edges. Devices move within their room. The ◀ ▶ buttons are still there, smaller, for a D-pad or keyboard. Also fixed tile names running under the ⋯ button: every button is at least the `--touch` width (56px on the wall), so the ⋯ button was wider than the room reserved for it; it is now 36px, and names wrap to two lines then end with …, with the full name as a tooltip.

**Dimming and fan speed on the tile, gray off-icons, and TV silhouettes.** A dimmable light or a fan with a percentage speed is now a horizontal slider on the tile itself: press and drag left or right to set the level, the tile fills to match, and the percentage shows while you drag. The command is sent on release (and every 300ms during a long drag). A quick tap still toggles on/off; a vertical move still scrolls the page; press-and-hold or the ⋯ button still opens the full sheet. Arrow keys adjust by 10%, with `role="slider"` and `aria-valuenow`. Off device icons use the theme's muted color; a lit bulb is a warm yellow. Each TV tile uses a silhouette that matches the set (Samsung Frame, Serif, Sero, or a thin-bezel flat screen); the Elhart TVs are all Crystal UHD CU7000, so they get the flat-screen icon. HA did not provide an `entity_picture` for them. Manufacturer, model and device class are included on `/api/home` entities when known.

**TVs on the Home page, and an editable layout.** Home Assistant `media_player` devices (Samsung and other TVs from SmartThings, and so on) now appear as tiles: tap to switch one on or off, and press and hold, or tap the ⋯ button, for volume down/up, mute, a volume slider and its inputs, each only when that TV says it supports it. **Edit** (top right of the Home page, a large touch button that works on the wall, a phone and the web) lets the family rearrange the page: ◀ ▶ move rooms, the devices inside a room and the scene chips one step at a time; **Hide** and **Show** take a device, scene or whole room off the page; **Wide** gives a room double width. Nothing is saved until **Done**, **Cancel** throws the changes away, and **Reset to default** restores the usual order with everything shown. The arrangement is one household-wide setting, `home_layout` (room order, hidden rooms, wide rooms, per-room device order, scene order), so every screen shows the same page; devices and rooms added in Home Assistant later appear after the arranged ones. Hidden devices and scenes still live in `home_hidden`, so Settings → Home shows the same choices. New API: `media_player` actions `turn_on`, `turn_off`, `toggle`, `volume_up`, `volume_down`, `mute`, `unmute`, `set_level` (volume 0-100) and `select_source` on `POST /api/home/entities/{id}/action`.

**Tapping outside a side panel closes it, and it asks before throwing away edits.** This covers the event panel, the meal editor, the add-widget picker and the About card. A tap on the dimmed area closes the panel, and that tap is consumed: it no longer also opens a new event on the calendar underneath. The tap is read from pointer events, so a finger that slides a little still counts. The browser sends no `click` for a slide of about 15px or more, which is why tapping outside used to be ignored on the wall touchscreen. A panel with unsaved edits asks **Save changes?** with large **Save**, **Discard** and **Keep editing** buttons. Save runs the panel's normal save, and if validation or the server refuses, the panel stays open and shows why. The same prompt appears for Escape, the TV remote's Back key, and Cancel. A panel with no edits closes without asking. In TV mode (`?tv=1`) the prompt sits inside the dialog, so the D-pad stays inside it, with focus on Save. Back means Keep editing.

**Day, 3 Day and Schedule views are gone.** The Day/Week/Month/Schedule switcher is now Week and Month, and the side navigation lists the same two. Week and Month already show everything those views did. Old links and bookmarks (`/calendar/today`, `/3day`, `/schedule`, anything unknown) and the app's front door open Week. No view is stored in localStorage or `sessionStorage` (the saved `default_view` setting is not read by the web app), so nothing stored can still name a removed view.

**The phone and TV connect screens can be read across the room.** Field text is near-black, placeholders and labels clear WCAG AA on the warm paper, errors are a dark red, and outlined buttons are no longer pale orange. Filled buttons stay the warm orange, with dark text.

**TV and phone updates install over the last copy.** Debug and release APKs are signed with one keystore in the repo, so a build from another machine no longer forces an uninstall. The version code is the number of git commits, and the version name is `VERSION` plus that count.

**The TV and phone apps ask for the calendar server.** The last address that
worked is tried first. `familycal.local` gives up quickly, and the address box
comes back with that address filled in. A TV remote can type an IP from the
number keys. Notes for running the server on a Windows PC with Docker Desktop
are in [docs/windows-server.md](docs/windows-server.md).

**Screens hear about a change within a second.** `GET /api/live` is a
Server-Sent Events stream. A commit — including a Google or iCloud pull —
names what changed, and open browsers and the TV app refetch that. Polling
stays as the fallback when the stream is down. See
[docs/live-and-offline.md](docs/live-and-offline.md).

**The wall keeps working through a network drop.** The last calendar, chores
and rewards stay on screen, with `Offline, last synced <time>`. Chore
check-offs, reward redeems and list ticks queue and replay with the same
`request_id`, so a retry does not award or spend stars twice. Event edits are
not queued: the server's copy wins.

**The API asks who you are, except on the wall.** Requests from the home network
(and from the Pi kiosk, which Docker presents as a private address) still need
no login. A phone off that network pairs with a short code shown in Settings →
Devices and then sends `Authorization: Bearer`. Tokens are stored as a hash and
can be revoked from the same screen. `GET /api/health` and the Google OAuth
callback stay public. `AUTH_MODE=off` is the old open API. See
[docs/authentication.md](docs/authentication.md).

**A mouse can do what a finger could.** Dragging across the calendar scrolls it,
or turns the page when the drag is sideways, and the buttons for those gestures
were already there. Hover and keyboard focus are visible. The pointer stays
visible in the app; the screensaver still hides it.

**A weekly event keeps its clock time across daylight saving.** A 4pm series no
longer reads as 3pm after the clocks go back. All-day events are unchanged.

**A dashboard list widget can show a list that isn't the first one.** The widget
has a picker. A deleted list stays missing instead of silently becoming the
other list.

## 0.5.12

**Week and 3 Day find their way home.** Scroll away and come back toward today, and the
view settles exactly on today's starting position (its week, or today in the first
column) once you're within half a day of it -- a firmer pull than the light snap onto any
other day. Scrolling away from today is never pulled back.

## 0.5.11

**Week and 3 Day scroll sideways, forever.** Drag or swipe left and right through the days
instead of paging; let go near the start of a day and it settles onto it. The hours still
scroll up and down, the day names stay pinned at the top, and the times stay pinned at the
left. The arrows still step a whole week (landing on the first day of the week) or three days,
and Today brings you back.

**Colour themes.** Settings → Display now offers Midnight (the dark look so far), Daylight (a
warm light theme for a bright kitchen) and Hearth (a warm, dim theme for evenings). The choice
is saved for the household, so every screen follows it. All three meet WCAG AA contrast;
Midnight's dimmer text is a touch brighter than before because the old shade fell short on
some surfaces. The screensaver stays dark in every theme.

**"Update available".** Once a day the server asks GitHub whether a newer Mantel has been
released, and the version badge says so when one has, with a link to what changed and the
one-line Docker upgrade. Nothing updates itself. `UPDATE_CHECK_ENABLED=false` turns the check
off entirely, with no network calls (see `docs/configuration.md`).

**Month view peeks at the next month**, so it's clear the page scrolls, and **the people
filter sits in the toolbar** beside Today and the arrows (on a phone, on a second line of it).

## 0.5.10

**Month view scrolls.** Swipe or scroll up and down to run through previous and next months
instead of paging one at a time. Let go near the start of a month and it settles onto it;
stop in the middle and it stays where you left it. The title follows whichever month is on
screen, and the arrows, Today and a sideways swipe still step a month at a time.

**The previous and next arrows sit together**, as one control beside Today, in every view.
Before, the title sat between them.

**An event can be moved to another calendar** -- from someone's Apple calendar to their
Google one, or to another person's. Change the calendar (or who it's for) in the edit dialog
and save; the dialog says first that it will be removed from where it was. Under the hood it
is created on the new calendar and deleted from the old one, since neither service can move
an event between accounts, so through the API the event comes back with a new `id`. A single
occurrence of a repeating event can't be moved on its own; the whole series can.

## 0.4.0

**iCloud calendars now sync, both ways, the same as Google.** Add an event on the wall
display and it appears in Apple Calendar on everyone's phones within seconds; add one on a
phone and it reaches the wall at the next sync. Deletes and repeating events included.

**Setting it up takes about a minute per person, with nothing to do for the household.**
Apple has no OAuth for calendars, so there is no developer account, no client ID or secret,
no redirect URI, and none of the LAN-address trouble that makes the Google setup what it is.
Each person makes an app-specific password at appleid.apple.com and pastes it into
**Settings → Apple** with their Apple ID. It is checked against iCloud before anything is
saved — a typo tells you immediately rather than becoming a sync that quietly never works —
and stored encrypted with your `SECRET_KEY`, like the Google client secret.

iCloud calendars arrive **switched off and unclaimed**, exactly like Google ones, so nothing
lands on the wall until somebody says so. Reminders lists are not offered: they cannot hold
an event. Calendars shared with you without edit rights are marked read-only.

**Repeating events from Apple work properly, including the awkward parts.** Apple sends a
series as one item with its rule rather than pre-expanded, so the app expands it locally —
the same as it already does for its own calendars. A single occurrence somebody moved,
renamed or cancelled on their phone comes through as well, and shows once, at the right
time. Cancelling one occurrence from the wall display cancels that occurrence, not the
series.

**Editing an event no longer throws away what this app doesn't model.** An update reads the
existing item and changes only the fields it owns, so an alarm or a guest list somebody set
on their phone survives being renamed here.

Under the hood, the sync engine no longer has Google baked into it: discovery, the push
queue, conflict resolution and full-resync recovery are shared, with the service-specific
parts behind a provider interface. Existing Google installs are unaffected — same behaviour,
same database, no migration step. Four unused dependencies were dropped from the image along
the way.

**Messages that used to say "Google" regardless.** A read-only iCloud calendar said it was
"read-only in Google"; the Settings footer reported "Google sync not configured" on an
install syncing happily with Apple. Both now name whichever service they mean.

## 0.3.2

**Adding an event no longer offers calendars that would swallow it.** The picker listed
every writable calendar, including Google calendars with syncing switched off — and the
push queue skips those, so the event saved locally, appeared on the wall, and never
reached Google, with nothing to say so. Only calendars that can actually carry an event
are offered now. Editing an existing event still lists the calendar it already lives on,
even if that one has since been switched off, so nothing moves behind your back.

**Syncing on/off moved to Settings → Calendars**, next to the claim dropdown, along with
the "synced 5 min ago" and error hints. That page already told you to switch Syncing on
for a calendar — a control that lived on the other tab. Settings → Google no longer lists
calendars at all; it is about credentials and connected accounts, and keeps "Sync now".

## 0.3.1

**A calendar you create in Google now shows up on its own.** Discovery only ever ran
once, at the moment an account was linked, so a calendar made or shared afterwards was
invisible here — and the only way to pick it up was to unlink the account and reconnect
it. Every sync now re-reads each account's calendar list, and **Settings → Calendars**
has a *Check for new calendars* button for when you don't want to wait for the timer.

New calendars still arrive with syncing switched off and unclaimed, so nothing lands on
a wall display because it appeared in Google. A failure on one account no longer hides
another account's new calendars.

## 0.3.0

**A configurable shortcut button on every page.** Set a label and a link under
Settings → Display and a button appears in a slim bar at the top of every screen —
for jumping to another dashboard, a camera page, whatever the wall display should be
one tap away from.

It is off by default. With no link set the bar isn't rendered and its grid row
collapses to nothing, so an install that doesn't use it pays no vertical space —
which is the resource a wall display has least of.

The link is restricted to `http` and `https`. This is a field anyone on the network
can write, and it lands in an `href`, so a `javascript:` URL would otherwise be
stored XSS wearing a settings field. A bare host like `dash.lan/?view=wall` is
accepted and gets `http://` added, since that's what people type.

## 0.2.12

**`/api/sync/status` said Google wasn't configured even when it was.** Credentials moved
out of `.env` and into the database in 0.2.2; this endpoint kept reading the environment,
so it reported `google_configured: false` on every install that set Google up through the
Settings page — which is all of them. The Settings page itself was always correct.

## 0.2.11

**Connecting a Google account no longer ends in a 500 when Google withholds calendar
access.** Asking for a scope is not the same as getting one: if the Calendar API isn't
enabled on the project, Google signs the person in, silently drops the calendar scope,
and returns a perfectly valid token. The app stored that account, then crashed on the
first calendar call with an unhandled 403.

Now the token's granted scopes are checked before anything is saved, and the person is
told what to fix — the Calendar API, or the scope under Data Access — in the app rather
than in a stack trace. A calendar listing that fails for any other reason marks the
account as needing attention instead of returning a server error.

**The Settings page shows OAuth errors at all now.** The callback could only report
failures through `?error=` on the redirect, and nothing read it, so every failed
connection looked identical to a cancelled one.

## 0.2.10

**Documented the setup that actually works on a home network.** The Google guide now has an
end-to-end walkthrough for pointing a subdomain you own at your reverse proxy: the DNS record,
why HTTP-01 certificates can never work for a private address and DNS-01 must be used instead,
config for Nginx Proxy Manager / Caddy / Traefik, and the DNS-rebinding-protection gotcha that
makes a name resolve on some devices and not others.

It ends with four `curl` checks that isolate a failure in order, including the one that matters
most: opening the callback path by hand should return the app's own 422 about a missing `state`
parameter. That "error" is the proof the route reaches the app — an HTML 404 or a 502 means the
proxy never forwarded it.

## 0.2.9

**The redirect-URI check now catches private domains like `.lan`.** 0.2.8 warned about
IP addresses, bare hostnames and `.local`, but waved through anything else that had a
dot in it and used HTTPS — so a reverse proxy serving `https://family.lan`, which is
what a lot of homelabs look like, was told it was fine and then refused by Google.
`.lan`, `.home`, `.internal`, `.corp`, `.intranet`, `.private` and friends are now
rejected with an explanation, because a valid certificate makes no difference: the
name has to be under a domain you actually own.

The setup guide adds the useful half of that: the name doesn't have to be reachable
from the internet. Google never fetches the redirect URI — your browser does — so a
record under your own domain pointing at a LAN address works, and you can keep
`family.lan` on the same proxy for everyday use.

## 0.2.8

**Fixed the Google setup advice for anyone on a home network.** Google refuses most
LAN addresses as OAuth redirect URIs — no IP addresses, no `.local`, no bare machine
names, and plain `http://` only for `localhost` — so following the old instructions
ended at *"Invalid Redirect: must end with a public top-level domain"*. The examples
in the docs were addresses Google would never have accepted.

Settings → Google now checks your address before you go anywhere near the console,
and if Google would refuse it, says so and gives you the two ways out: register the
loopback URI and do the one-time connect over an SSH tunnel (it prints the exact
command for your host), or put the app behind a real HTTPS name such as
`tailscale serve`. The redirect URI is only used while connecting — refreshing a
token never touches it — so the tunnel is needed once per person and never again.

## 0.2.7

- **A typo in an event filter no longer reads as a broken server.**
  `GET /api/events?calendar_ids=abc` answered 500; it now answers 400 naming the
  field. `user_ids` had the same fault. This matters most for the integration path
  the AI guide documents: 500 is the one status a client treats as "retry later"
  rather than "fix your request", so a typo could turn into a retry loop against a
  perfectly healthy calendar. Trailing and repeated commas still work — `,1,,` is
  sloppy, not wrong. Found by a tool building a wall-display widget against the API.
- Released images now report `build_time` as ISO-8601 instead of a bare epoch.

## 0.2.6

- **Prebuilt images actually get a `latest` tag.** The release workflow only runs on a
  `v*` tag, where `is_default_branch` is false — so the guard on the `latest` tag meant
  it was never published. `docker run ghcr.io/heyitsmiike101/mantel:latest` works from
  this release on.
- Generating a `SECRET_KEY` is now `openssl rand -base64 32` instead of pulling a Python
  image to call Fernet. Any string works; it gets hashed into a key.

## 0.2.5

Two display fixes, both spotted while capturing the README screenshots.

- **Short events no longer print their title over their time.** A 15-minute block is
  shorter than two lines of text, and the two lines were shrinking below their own
  line boxes and painting on top of each other. Blocks that short now put the time in
  front of the title on one line, and any block that still runs out of room clips
  cleanly instead of overlapping.
- **List names are no longer truncated for no reason.** "Groceries" was rendering as
  "Groce…" with half the card empty, because the Clear and Delete buttons were
  squeezing the title rather than wrapping below it.

## 0.2.4

**Publishing the Google app is now its own step, and you can't miss it.** It was a footnote
inside another step, in a walkthrough that started collapsed — so the one setting that decides
whether your family reconnects every 7 days was the easiest thing on the page to skip. It is now
step 4 of 8, with a warning box explaining that publishing does not submit anything for review.
The walkthrough also opens by default when Google isn't set up yet, and the "needs connecting
again" banner now names Testing mode as the likely cause and links straight to the fix.

**Updated for Google's current console.** The old *APIs & Services → OAuth consent screen* and
*Credentials* pages are now the *Google Auth Platform*, split into Overview, Audience and
Clients. Every link in the app and in docs/setup-google-oauth.md points at the current pages.

## 0.2.3

**The API guide is a tab in Settings.** It used to be its own item in the navigation bar, which
put developer documentation on the same footing as the calendar itself on a wall display. It now
lives under **Settings → API**, alongside links to the interactive docs, the OpenAPI schema and
the raw markdown. An old `/docs` bookmark redirects there.

**Fixed: the API guide hung the browser instead of rendering.** The little markdown renderer had
a loop that could decline a line without consuming it, and one line of the guide — a paragraph
beginning with a `code span` — hit exactly that case, so the tab locked up on a blank page. Every
branch now advances, and the renderer is tested against the real guide the app ships rather than
against a sample.

## 0.2.2

**The family is on the calendar page.** Everyone appears as a chip along the top, filled with
their own colour, so the row doubles as the legend for the grid below. Tap somebody to grey them
out and their events disappear; tap again to bring them back. The choice is remembered per
device, so the kitchen display and your phone can show different things, and somebody added to
the family later shows up straight away rather than arriving hidden. Events on a calendar nobody
has claimed always stay visible — they belong to the household.

**Google is configured in the app now, not in a file.** Settings → Google walks you through
creating the credentials in Google Cloud, with clickable links, the exact redirect URI for your
installation ready to copy, and boxes to paste the Client ID and secret into. It takes effect
immediately — no editing `.env`, no restarting the container. Each family member then presses
**Connect an email** on their own row, and can add as many accounts as they like.

The client secret is encrypted at rest and is never readable back through the API; the same is
now true of the Home Assistant token.

**`.env` is down to two things**: the port, and a `SECRET_KEY` to encrypt everything with. An
existing installation's Google credentials are copied out of `.env` into the app on first start,
so upgrades keep working and Settings shows the truth from then on.

## 0.2.1

Fixes from a code review of the 0.2.0 release.

- **Subscribed calendars no longer show repeating events twice.** Once a series
  has been pushed to Google, Google's expanded instances are the record; the feed
  was also exporting our copy's repeat rule, so subscribers rendered the whole
  series a second time.
- **Events added in Google Calendar now reach Home Assistant.** Only edits made
  in this app were telling HA to refresh, so with HA's own polling switched off
  (as the setup guide instructs) an event added on a phone never appeared there.
- **The dashboard survives a network drop.** Its widget layout, lists and weather
  weren't cached for offline use, so a wall display fell back to the empty-
  dashboard placeholder — only the calendar views actually worked offline.
- **Subscription links now use the address you're browsing on** instead of
  `PUBLIC_BASE_URL`, which defaults to localhost and produced a link that
  silently failed on phones.
- A weather outage can no longer tie up the server: one refresh runs at a time
  and everyone else is served the cached forecast immediately.
- Repeating events that finished long ago are no longer re-expanded on every
  calendar request.
- A future upgrade that needs a manual migration now refuses to start instead of
  booting onto an incomplete database.
- Internal: fixed an ORM hazard in recurrence expansion, and Home Assistant
  refreshes now coalesce onto one worker instead of a thread per write.

## 0.2.0

Wall-display release: everything needed to actually mount this on a wall and live with it.

**Runs on a Raspberry Pi.** Images are built for `linux/amd64` and `linux/arm64`, and
[docs/kiosk-setup.md](docs/kiosk-setup.md) covers Chromium kiosk mode, Fully Kiosk on Android,
iPad Guided Access, turning the screen off at night (the command most guides give you stopped
working in Raspberry Pi OS Bookworm), and keeping a wall tablet's battery from swelling.

**It keeps working when the network doesn't.** A service worker keeps the last known schedule
on screen instead of going blank — deliberately never caching the version endpoint, so the
self-update still works.

**Screensaver.** Photo slideshow or a large clock with today's agenda, an overnight blackout
window, and burn-in protection. Photos are uploaded in Settings, re-encoded on the way in
(which strips EXIF location data), and stored beside the database so backups already cover them.

**Repeating events.** Daily, weekly on chosen days, monthly or yearly, with an optional end
date. Series push to Google as an RRULE.

**Per-person filter.** Tap a family member to see only their week. Remembered per device, so
the kitchen display and a phone can differ.

**Weather**, with no API key and no account: the National Weather Service in the United States
(including watches and warnings) and Open-Meteo everywhere else. Set a location by searching
for a town.

**Shared lists** for groceries and chores, tickable from the wall, with a dashboard widget.

**Countdown widget** for the things everyone's waiting for.

**Subscribe on your phone.** A read-only calendar feed for Apple Calendar, Outlook or Google —
which doubles as the Home Assistant integration: pair it with the push-refresh setting and a
calendar entity in HA updates within a second instead of once a day. No custom component to
install. See [docs/sharing-and-home-assistant.md](docs/sharing-and-home-assistant.md).

**Upgrades apply themselves.** Database columns added by a new release are created at startup,
so `git pull && ./run.sh` no longer needs a manual migration.

## 0.1.0

First release.

- Today, 3-day, week and month calendar views, built for touch in portrait and landscape
- Family members with per-person colors; each can link multiple Google accounts and claim
  the calendars they own
- Two-way Google Calendar sync with incremental pulls, an automatic push queue, and
  last-write-wins conflict handling
- Customizable dashboard wall
- Screens hard-reload themselves when a new version is deployed; the version is always visible
- Full REST API with OpenAPI docs and a guide written for AI agents at `/api/ai-guide`
- Single Docker container, SQLite in WAL mode, no login
