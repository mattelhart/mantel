import type { CSSProperties, ReactNode } from 'react'
import { publicEntityPicture, tvStyle, type HomeEntity, type TvStyle } from './homeModel'

/**
 * Home Control device glyphs. Original 24×24 duotone drawings (outline + soft
 * fill), in the spirit of Phosphor duotone, not copied from any set.
 */

type Tone = 'heat' | 'cool'

function Glyph({
  kind,
  children,
  spin,
  tone,
  style,
}: {
  kind: string
  children: ReactNode
  spin?: boolean
  tone?: Tone | null
  style?: CSSProperties
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={spin ? 'home-icon home-icon--spin' : 'home-icon'}
      data-icon={kind}
      data-tone={tone || undefined}
      style={style}
      fill="none"
      aria-hidden
    >
      {children}
    </svg>
  )
}

/** Soft fill opacity for a lit bulb: dim at low brightness, full at 100%. */
export function lightFillOpacity(on: boolean | null, level: number | null): number | undefined {
  if (!on) return undefined
  if (level == null) return 0.9
  return Math.round((0.3 + 0.7 * Math.min(100, Math.max(0, level)) / 100) * 100) / 100
}

/** Heat vs cool color for a thermostat. Prefers the current action, then the mode. */
export function climateTone(entity: Pick<HomeEntity, 'available' | 'attrs' | 'state'>): Tone | null {
  if (!entity.available) return null
  const action = String(entity.attrs.hvac_action ?? '').toLowerCase()
  if (action === 'heating') return 'heat'
  if (action === 'cooling' || action === 'drying') return 'cool'
  const mode = String(entity.attrs.hvac_mode ?? entity.state ?? '').toLowerCase()
  if (mode === 'off') return null
  if (mode === 'heat' || mode === 'heat_cool') return 'heat'
  if (mode === 'cool' || mode === 'dry') return 'cool'
  return null
}

function LightIcon({ on, level }: { on: boolean | null; level: number | null }) {
  const opacity = lightFillOpacity(on, level)
  return (
    <Glyph kind="light" style={opacity != null ? ({ '--icon-fill-opacity': String(opacity) } as CSSProperties) : undefined}>
      <path
        className="home-icon__fill"
        d="M12 4.05c-3.05 0-5.45 2.5-5.45 5.65 0 2.2 1.15 4.1 3 5.2v.8h4.9v-.8c1.85-1.1 3-3 3-5.2C17.45 6.55 15.05 4.05 12 4.05Z"
      />
      <path
        className="home-icon__stroke"
        d="M8.05 14.9C6.2 13.7 5 11.6 5 9.2 5 5.4 8.05 3.15 12 3.15S19 5.4 19 9.2c0 2.4-1.2 4.5-3.05 5.7"
      />
      <path className="home-icon__stroke" d="M10.05 8.35c.6 1.65 2.3 1.65 2.9 0M12 8.7v3.55" />
      <path className="home-icon__stroke" d="M9.35 15.55h5.3M9.5 16.7h5" />
      <path className="home-icon__stroke" d="M9.65 16.7h4.7v2.15c0 .65-.5 1.15-1.15 1.15h-2.4c-.65 0-1.15-.5-1.15-1.15V16.7Z" />
      <path className="home-icon__stroke" d="M11.15 20.1h1.7" />
    </Glyph>
  )
}

function FanIcon({ spin }: { spin: boolean }) {
  const blade =
    'M12 10.55c-1.85-2.45-2.45-5.4-.85-7.1.55-.6 1.4-.3 1.6.7 1.8-.3 2.8 2.2.8 5.2-.55.8-1.1 1.2-1.55 1.2Z'
  return (
    <Glyph kind="fan" spin={spin}>
      <g className="home-icon__blades">
        <path className="home-icon__fill" d={blade} />
        <path className="home-icon__fill" d={blade} transform="rotate(90 12 12)" />
        <path className="home-icon__fill" d={blade} transform="rotate(180 12 12)" />
        <path className="home-icon__fill" d={blade} transform="rotate(270 12 12)" />
        <path className="home-icon__stroke" d={blade} />
        <path className="home-icon__stroke" d={blade} transform="rotate(90 12 12)" />
        <path className="home-icon__stroke" d={blade} transform="rotate(180 12 12)" />
        <path className="home-icon__stroke" d={blade} transform="rotate(270 12 12)" />
      </g>
      <circle className="home-icon__fill" cx="12" cy="12" r="2.45" />
      <circle className="home-icon__stroke" cx="12" cy="12" r="2.45" />
      <circle className="home-icon__solid" cx="12" cy="12" r="0.85" />
    </Glyph>
  )
}

function SwitchIcon() {
  return (
    <Glyph kind="switch">
      <rect className="home-icon__fill" x="5.4" y="3.4" width="13.2" height="17.2" rx="2.4" />
      <rect className="home-icon__stroke" x="5.4" y="3.4" width="13.2" height="17.2" rx="2.4" />
      <rect className="home-icon__solid" x="8.25" y="7.15" width="1.85" height="5.4" rx="0.45" />
      <rect className="home-icon__solid" x="13.9" y="7.15" width="1.85" height="5.4" rx="0.45" />
      <path className="home-icon__stroke" d="M10.15 15.05c.55 1.7 3.15 1.7 3.7 0" />
    </Glyph>
  )
}

function BooleanIcon({ on }: { on: boolean }) {
  return (
    <Glyph kind="input_boolean">
      <rect className="home-icon__fill" x="3.2" y="7.5" width="17.6" height="9" rx="4.5" />
      <rect className="home-icon__stroke" x="3.2" y="7.5" width="17.6" height="9" rx="4.5" />
      <circle className="home-icon__solid" cx={on ? 16.2 : 7.8} cy="12" r="2.85" />
    </Glyph>
  )
}

function CoverIcon() {
  return (
    <Glyph kind="cover">
      <rect className="home-icon__fill" x="4.2" y="3.5" width="15.6" height="17" rx="1.3" />
      <rect className="home-icon__stroke" x="4.2" y="3.5" width="15.6" height="17" rx="1.3" />
      <path className="home-icon__stroke" d="M4.2 7.35h15.6" />
      <path className="home-icon__stroke" d="M5.5 9.7h13M5.5 12h13M5.5 14.3h13" />
      <path className="home-icon__stroke" d="M12 7.35v13.15" />
    </Glyph>
  )
}

function ClimateIcon({ tone }: { tone: Tone | null }) {
  const turn = tone === 'heat' ? 28 : tone === 'cool' ? -145 : -20
  return (
    <Glyph kind="climate" tone={tone}>
      <circle className="home-icon__fill" cx="12" cy="12" r="8.55" />
      <circle className="home-icon__stroke" cx="12" cy="12" r="8.55" />
      <circle className="home-icon__stroke" cx="12" cy="12" r="6.15" style={{ strokeWidth: 1.15 }} />
      <path className="home-icon__stroke" d="M12 4.65v1.55M19.35 12h-1.55M12 19.35v-1.55M4.65 12h1.55" />
      <g transform={`rotate(${turn} 12 12)`}>
        <path className="home-icon__stroke" d="M12 12V6.35" />
      </g>
      <circle className="home-icon__solid" cx="12" cy="12" r="1.15" />
    </Glyph>
  )
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <Glyph kind={open ? 'lock-open' : 'lock'}>
      <rect className="home-icon__fill" x="5.4" y="10.3" width="13.2" height="10" rx="2.2" />
      <rect className="home-icon__stroke" x="5.4" y="10.3" width="13.2" height="10" rx="2.2" />
      <circle className="home-icon__solid" cx="12" cy="14.25" r="1.15" />
      <path className="home-icon__solid" d="M11.4 14.6h1.2v3.05h-1.2z" />
      {open ? (
        <path className="home-icon__stroke" d="M8.15 10.3V7.45a3.95 3.95 0 0 1 7.55-1.55" />
      ) : (
        <path className="home-icon__stroke" d="M8.15 10.3V7.45a3.95 3.95 0 0 1 7.9 0V10.3" />
      )}
    </Glyph>
  )
}

function SceneIcon() {
  return (
    <Glyph kind="scene">
      <path
        className="home-icon__fill"
        d="M12 3.4 13.85 9.1l6.15.12-4.92 3.72 1.82 6.16L12 15.85l-4.9 3.25 1.82-6.16L4 9.22l6.15-.12Z"
      />
      <path
        className="home-icon__stroke"
        d="M12 3.4 13.85 9.1l6.15.12-4.92 3.72 1.82 6.16L12 15.85l-4.9 3.25 1.82-6.16L4 9.22l6.15-.12Z"
      />
    </Glyph>
  )
}

function ScriptIcon() {
  return (
    <Glyph kind="script">
      <rect className="home-icon__fill" x="3.6" y="3.6" width="16.8" height="16.8" rx="4" />
      <rect className="home-icon__stroke" x="3.6" y="3.6" width="16.8" height="16.8" rx="4" />
      <path className="home-icon__solid" d="M10.05 8.15v7.7L16.4 12Z" />
    </Glyph>
  )
}

function SensorIcon() {
  return (
    <Glyph kind="sensor">
      <rect className="home-icon__fill" x="7" y="9.4" width="10" height="10.8" rx="2.6" />
      <rect className="home-icon__stroke" x="7" y="9.4" width="10" height="10.8" rx="2.6" />
      <circle className="home-icon__stroke" cx="12" cy="14.7" r="2.15" />
      <path className="home-icon__stroke" d="M9.15 8.15a4.05 4.05 0 0 1 5.7 0M7.55 6.15a6.4 6.4 0 0 1 8.9 0" />
    </Glyph>
  )
}

/** Thin-bezel flat screen with a central stand — Samsung Crystal UHD / CU7000 and most modern sets. */
function TvFlat() {
  return (
    <Glyph kind="tv-flat">
      <rect className="home-icon__fill" x="4.1" y="5.1" width="15.8" height="10" rx="0.45" />
      <rect className="home-icon__stroke" x="2.6" y="3.6" width="18.8" height="13" rx="1.2" />
      <path className="home-icon__solid" d="M11 17.05h2l1.55 3.15H9.45z" />
    </Glyph>
  )
}

/** The Frame: a deeper gallery bezel, no stand, like a picture on the wall. */
function TvFrame() {
  return (
    <Glyph kind="tv-frame">
      <rect className="home-icon__fill" x="5" y="5.8" width="14" height="12.2" />
      <rect className="home-icon__stroke" x="2.5" y="3.5" width="19" height="16.8" rx="0.6" style={{ strokeWidth: 2.3 }} />
    </Glyph>
  )
}

/** The Serif: the distinctive I-beam / typographic silhouette. */
function TvSerif() {
  return (
    <Glyph kind="tv-serif">
      <rect className="home-icon__fill" x="7.6" y="7.4" width="8.8" height="9.2" />
      <path
        className="home-icon__solid"
        fillRule="evenodd"
        d="M3 4.2h18v3.2h-3.2v9.2H21v3.2H3v-3.2h3.2V7.4H3V4.2Zm4.6 3.2h8.8v9.2H7.6V7.4Z"
      />
    </Glyph>
  )
}

/** The Sero: a taller, portrait-leaning set on a compact stand. */
function TvSero() {
  return (
    <Glyph kind="tv-sero">
      <rect className="home-icon__fill" x="7.05" y="4.05" width="9.9" height="13" rx="0.4" />
      <rect className="home-icon__stroke" x="5.5" y="2.5" width="13" height="16.1" rx="1.2" />
      <path className="home-icon__solid" d="M9 19.05h6l1.35 2.4H7.65z" />
    </Glyph>
  )
}

/** Generic TV fallback: slightly thicker bezel and a wide stand. */
function TvGeneric() {
  return (
    <Glyph kind="tv-generic">
      <rect className="home-icon__fill" x="4.3" y="5.7" width="15.4" height="9.1" rx="0.4" />
      <rect className="home-icon__stroke" x="2.6" y="4.1" width="18.8" height="12.3" rx="1.6" />
      <path className="home-icon__solid" d="M8.1 17.05h7.8l1.7 3.2H6.4z" />
    </Glyph>
  )
}

const TV: Record<TvStyle, () => ReactNode> = {
  flat: TvFlat,
  frame: TvFrame,
  serif: TvSerif,
  sero: TvSero,
  generic: TvGeneric,
}

function TvIcon({ entity }: { entity: HomeEntity }) {
  const picture = publicEntityPicture(entity.entity_picture)
  const style = tvStyle(entity.manufacturer, entity.model, entity.model_id, entity.device_class)
  const Silhouette = TV[style]
  if (picture) {
    return (
      <span className="home-icon home-icon--photo" data-icon={`tv-${style}`}>
        <img src={picture} alt="" />
      </span>
    )
  }
  return <Silhouette />
}

export function DeviceIcon({ entity }: { entity: HomeEntity }) {
  switch (entity.domain) {
    case 'light':
      return <LightIcon on={entity.on} level={entity.level} />
    case 'fan':
      return <FanIcon spin={!!entity.on && entity.available} />
    case 'switch':
      return <SwitchIcon />
    case 'input_boolean':
      return <BooleanIcon on={!!entity.on} />
    case 'cover':
      return <CoverIcon />
    case 'climate':
      return <ClimateIcon tone={climateTone(entity)} />
    case 'lock':
      return <LockIcon open={!!entity.on} />
    case 'media_player':
      return <TvIcon entity={entity} />
    case 'scene':
      return <SceneIcon />
    case 'script':
      return <ScriptIcon />
    case 'binary_sensor':
    case 'sensor':
      return <SensorIcon />
    default:
      return (
        <Glyph kind="unknown">
          <circle className="home-icon__fill" cx="12" cy="12" r="6.2" />
          <circle className="home-icon__stroke" cx="12" cy="12" r="6.2" />
        </Glyph>
      )
  }
}
