#!/usr/bin/env node
/** Playwright check: Home Control Edit mode must not overflow horizontally
 *  on the wall (1920×1080 and 1280×800 with ?tv=1) or on a phone, and edit
 *  controls (dashed room frames, Hide pills, the help banner, arrows) must sit
 *  fully inside the viewport's left and right edges.
 *
 *  Usage: DIST=/path/to/frontend/dist node scripts/check-home-edit-clip.mjs
 *  Optional: OUT=/path/to/screenshots CHROME=/usr/bin/google-chrome
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const repoFrontend = path.resolve(here, '..')
const dist = path.resolve(process.env.DIST || path.join(repoFrontend, 'dist'))
const out = process.env.OUT ? path.resolve(process.env.OUT) : null

function loadPlaywright() {
  const candidates = [
    path.join(repoFrontend, 'node_modules/playwright-core'),
    path.join(repoFrontend, '../node_modules/playwright-core'),
    '/workspace/mantel-work/pw/node_modules/playwright-core',
  ]
  for (const dir of candidates) {
    try {
      return require(dir)
    } catch {}
  }
  throw new Error('playwright-core not found; set NODE_PATH or install it')
}

const { chromium } = loadPlaywright()

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  throw new Error(`No frontend build at ${dist}. Run npm run build, or set DIST.`)
}
if (out) fs.mkdirSync(out, { recursive: true })

const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
}
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(req.url.split('?')[0]))
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html')
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(0)
await new Promise((r) => server.on('listening', r))
const base = `http://127.0.0.1:${server.address().port}`

const e = (entity_id, name, area_id, o = {}) => {
  const domain = entity_id.split('.')[0]
  return { entity_id, domain, name, area_id, state: 'on', available: true, on: true, level: null, adjustable: false, attrs: {}, ...o }
}
const light = (id, name, area, on, level) => e(id, name, area, { on, state: on ? 'on' : 'off', level: on ? level : 0, adjustable: true })
const fan = (id, name, area, on, level) => e(id, name, area, { on, state: on ? 'on' : 'off', level: on ? level : 0, adjustable: true })
const tv = (id, name, area, on, source, model) =>
  e(id, name, area, {
    on, state: on ? 'on' : 'off', level: 22, adjustable: true,
    manufacturer: 'Samsung Electronics', model, model_id: model, device_class: 'tv',
    attrs: { can_power: true, can_volume_step: true, can_mute: true, can_source: true, muted: false, ...(on ? { source } : {}), sources: ['HDMI1', 'HDMI2', 'HDMI3', 'Netflix', 'YouTube', 'Live TV'] },
  })
const clim = (id, area, t) => e(`climate.${id}`, 'Climate', area, { state: 'cool', attrs: { current_temperature: t, hvac_mode: 'cool', temperature: t + 1, min_temp: 60, max_temp: 85, step: 1, hvac_modes: ['off', 'cool', 'heat'] } })
const rooms = () => [
  { area_id: 'austin', name: "Austin's Bedroom", entities: [light('light.austin_lamp', 'Lamp', 'austin', true, 60), fan('fan.austin_fan', 'Fan', 'austin', false, 0), clim('austin', 'austin', 71)] },
  { area_id: 'back_entry', name: 'Back Entry', entities: [light('light.back_entry', 'Back Entry Light', 'back_entry', false, 0), e('lock.back_door', 'Back Door', 'back_entry', { state: 'locked', on: false })] },
  { area_id: 'basement', name: 'Basement', entities: [
    light('light.basement_main', 'Main Lights', 'basement', true, 80), light('light.basement_bar', 'Bar Pendants Over The Counter', 'basement', false, 0),
    light('light.basement_stair', 'Stairs', 'basement', true, 100), light('light.basement_shelf', 'Shelf Lights', 'basement', false, 0),
    clim('basement', 'basement', 68), tv('media_player.basement_game_tv', 'Game TV', 'basement', true, 'HDMI2', 'UN55CU7000FXZA'),
    tv('media_player.basement_basement_tv', 'Basement TV', 'basement', false, '', 'UN65CU7000FXZA'),
    fan('fan.basement_fan', 'Basement Fan', 'basement', true, 33), light('light.basement_cove', 'Cove Lights', 'basement', true, 40),
    light('light.basement_closet', 'Closet', 'basement', false, 0)] },
  { area_id: 'sitting', name: 'Basement Sitting Area', entities: [light('light.sit_lamp', 'Floor Lamp', 'sitting', true, 55), light('light.sit_table', 'Table Lamp', 'sitting', false, 0)] },
  { area_id: 'work', name: 'Basement Work Area', entities: [light('light.work_desk', 'Desk Lights', 'work', true, 90), light('light.work_shop', 'Shop Lights', 'work', true, 100), fan('fan.work_fan', 'Work Fan', 'work', false, 0), e('switch.work_outlet', 'Workbench Outlet', 'work')] },
  { area_id: 'brooklyn', name: "Brooklyn's Bedroom", entities: [light('light.bk_lamp', 'Lamp', 'brooklyn', false, 0), fan('fan.bk_fan', 'Fan', 'brooklyn', true, 66), clim('brooklyn', 'brooklyn', 70)] },
  { area_id: 'exterior', name: 'Exterior', entities: [light('light.ext_porch', 'Porch Light', 'exterior', true, 100), light('light.ext_garden', 'Garden Path', 'exterior', false, 0), light('light.ext_flood', 'Flood Lights', 'exterior', false, 0), e('lock.front', 'Front Door', 'exterior', { state: 'locked', on: false })] },
  { area_id: 'furnace', name: 'Furnace Room', entities: [light('light.furnace', 'Furnace Light', 'furnace', false, 0)] },
  { area_id: 'garage', name: 'Garage', entities: [light('light.garage_main', 'Garage Lights', 'garage', true, 100), e('cover.garage_door', 'Garage Door', 'garage', { state: 'closed', on: false })] },
  { area_id: 'kitchen', name: 'Kitchen', entities: [light('light.kitchen_pendants', 'Pendants', 'kitchen', true, 100), light('light.kitchen_under', 'Under Cabinet', 'kitchen', false, 0), light('light.kitchen_main', 'Main Lights', 'kitchen', true, 70), light('light.kitchen_island', 'Island', 'kitchen', false, 0)] },
  { area_id: 'living_room', name: 'Living Room', entities: [light('light.lr_lamp', 'Lamp', 'living_room', true, 40), fan('fan.lr_fan', 'Ceiling Fan', 'living_room', true, 33), clim('lr', 'living_room', 70), tv('media_player.living_room_living_room_tv', 'Living Room TV', 'living_room', true, 'Netflix', 'UN55CU7000FXZA')] },
  { area_id: 'master', name: 'Master Bedroom', entities: [light('light.master_lamp', 'Lamp', 'master', false, 0), fan('fan.master_fan', 'Fan', 'master', true, 66), clim('master', 'master', 69)] },
]
const actions = () => [
  e('scene.basement_off', 'Basement Off', null, { on: null, state: 'scening' }),
  e('scene.arriving', 'Smart Bridge Arriving Home', null, { on: null, state: 'scening' }),
  e('scene.away', 'Smart Bridge Away', null, { on: null, state: 'scening' }),
]
const settingsOf = (scale) => ({
  theme: 'airy', display_scale: scale, home_favorites: [], home_hidden: [], first_day_of_week: 0, time_format_24h: false,
  home_layout: { rooms: [], hidden_rooms: [], wide_rooms: [], devices: {}, scenes: [] },
  screensaver_enabled: false, screensaver_mode: 'off', burn_in_shift: false, weather_enabled: false,
  ha_base_url: 'http://ha.local:8123', ha_token: '', server: { version: 'demo', ha_token_set: true, google_configured: false, icloud_linked: false, sync_enabled: false },
})

async function disableWorker(page) {
  // The production service worker would otherwise intercept /api/settings and,
  // against this static server, serve index.html, so display_scale never applies.
  await page.route('**/sw.js*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '// disabled for clip check' }),
  )
}

async function mock(page, scale) {
  const settings = settingsOf(scale)
  await disableWorker(page)
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const pth = new URL(req.url()).pathname
    const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
    if (pth === '/api/home/live') return route.abort()
    if (pth === '/api/home') return json({ status: 'ok', message: '', rooms: rooms(), actions: actions() })
    if (pth === '/api/settings') {
      if (req.method() === 'PATCH') Object.assign(settings, JSON.parse(req.postData() ?? '{}'))
      return json(settings)
    }
    if (pth.startsWith('/api/home/entities/')) return json({ ok: true })
    if (pth === '/api/users') return json([])
    if (pth === '/api/ai-guide') return route.fulfill({ status: 200, contentType: 'text/markdown', body: '# API guide for AI agents\n' })
    return json(pth.endsWith('s') ? [] : {})
  })
}

// Runs in the page. Outlines are not in getBoundingClientRect, so add outline + offset.
function pageFunction() {
  const html = document.documentElement
  const home = document.querySelector('.home')
  const main = document.querySelector('.shell__main')
  const failures = []
  const checkScroll = (name, el) => {
    if (!el) return
    if (el.scrollWidth > el.clientWidth + 1) {
      failures.push(`${name} scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`)
    }
    if (el.scrollLeft !== 0) failures.push(`${name} scrollLeft is ${el.scrollLeft}, expected 0`)
  }
  checkScroll('document', html)
  checkScroll('.shell__main', main)
  checkScroll('.home', home)

  const inset = (el) => {
    const cs = getComputedStyle(el)
    const width = Number.parseFloat(cs.outlineWidth) || 0
    const offset = Number.parseFloat(cs.outlineOffset) || 0
    return width + offset
  }
  const vw = { left: 0, right: innerWidth }
  // The main column is the visible page; nav is allowed to own the left of the wall.
  const mainBox = main ? main.getBoundingClientRect() : { left: 0, right: innerWidth }
  for (const sel of ['.home__banner', '.home-room--edit', '.home-edit__chip', '.home-scene-edit', '.home-edit__arrow', '.home-edit__grip', '.home__editbar .btn', '.home__title']) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      const ring = inset(el)
      const left = r.left - ring
      const right = r.right + ring
      if (left < vw.left - 0.5 || right > vw.right + 0.5) {
        failures.push(`${sel} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" box ${Math.round(left)}–${Math.round(right)} is outside the viewport 0–${innerWidth}`)
      }
      // Also stay inside the main pane (do not slide under the side rail).
      if (left < mainBox.left - 0.5 || right > mainBox.right + 0.5) {
        failures.push(`${sel} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)}" box ${Math.round(left)}–${Math.round(right)} is outside main ${Math.round(mainBox.left)}–${Math.round(mainBox.right)}`)
      }
    }
  }
  return {
    failures,
    sizes: {
      document: { sw: html.scrollWidth, cw: html.clientWidth, sl: html.scrollLeft },
      main: main ? { sw: main.scrollWidth, cw: main.clientWidth, sl: main.scrollLeft } : null,
      home: home ? { sw: home.scrollWidth, cw: home.clientWidth, sl: home.scrollLeft } : null,
    },
  }
}

const cases = [
  { name: 'wall-1920', width: 1920, height: 1080, url: '/home?tv=1', scale: 'wall' },
  { name: 'wall-1280', width: 1280, height: 800, url: '/home?tv=1', scale: 'wall' },
  { name: 'phone', width: 390, height: 844, url: '/home', scale: 'normal', touch: true, dpr: 2, mobile: true },
]

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  args: ['--no-sandbox'],
})

let failed = 0
for (const c of cases) {
  const ctx = await browser.newContext({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: c.dpr || 1,
    hasTouch: !!c.touch,
    isMobile: !!c.mobile,
    serviceWorkers: 'block',
  })
  const page = await ctx.newPage()
  await mock(page, c.scale)
  await page.goto(base + c.url)
  await page.waitForSelector('.home-room')
  await page.waitForFunction(`document.documentElement.dataset.scale === ${JSON.stringify(c.scale)}`)
  await page.getByText('✎ Edit').click()
  await page.waitForSelector('.home[data-editing] .home-room--edit')
  await page.waitForTimeout(300)
  const result = await page.evaluate(pageFunction)
  if (out) await page.screenshot({ path: path.join(out, `${c.name}.png`) })
  if (result.failures.length) {
    failed += result.failures.length
    console.error(`FAIL ${c.name}`, result.sizes)
    for (const f of result.failures) console.error('  -', f)
  } else {
    console.log(`PASS ${c.name}`, result.sizes)
  }
  await ctx.close()
}

await browser.close()
server.close()
if (failed) {
  console.error(`${failed} clip/overflow check(s) failed`)
  process.exit(1)
}
console.log('All Home Control edit-mode clip checks passed')
