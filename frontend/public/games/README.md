# Vendored games

These games are copied into the app so the wall can play them offline, same-origin,
inside Mantel's chrome. No third-party hosts are loaded at runtime.

- `2048/` — [gabrielecirulli/2048](https://github.com/gabrielecirulli/2048), MIT (LICENSE.txt).
- `memory-match/` and `minesweeper/` — [mashukui/web-games](https://github.com/mashukui/web-games), MIT (LICENSE).
  The shared `i18n.js` script and analytics were left out; the English labels already
  in each HTML file are used as-is. External footer links were replaced with a
  text credit so a tap cannot navigate the kiosk away from Mantel.
