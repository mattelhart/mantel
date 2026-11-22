import type { ReactNode } from 'react'
import { publicEntityPicture, tvStyle, type HomeEntity, type TvStyle } from './homeModel'

/** 24×24, currentColor, so a tile can be warm yellow when on and gray when off. */
function Glyph({
  kind,
  children,
}: {
  kind: string
  children: ReactNode
}) {
  return (
    <svg viewBox="0 0 24 24" className="home-icon" data-icon={kind} aria-hidden>
      {children}
    </svg>
  )
}

function LightIcon() {
  return (
    <Glyph kind="light">
      {/* Bulb + base. The fill goes warm yellow when the light is on. */}
      <path
        fill="currentColor"
        d="M12 2.5c-3.4 0-6.2 2.7-6.2 6.1 0 2.4 1.3 4.4 3.2 5.5v1.6c0 .6.5 1.1 1.1 1.1h3.8c.6 0 1.1-.5 1.1-1.1v-1.6c1.9-1.1 3.2-3.1 3.2-5.5C18.2 5.2 15.4 2.5 12 2.5Zm-1.5 15.2h3v.8a1.5 1.5 0 0 1-3 0v-.8Zm.4 2.2h2.2c.3 1-.6 1.8-1.1 1.8s-1.4-.8-1.1-1.8Z"
      />
    </Glyph>
  )
}

function FanIcon() {
  return (
    <Glyph kind="fan">
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path
        fill="currentColor"
        d="M12 5c2.2-2.8 6.2-2.2 7.4.8 1 2.4-.3 5-2.5 6L12 12c.3-2.6 1.3-5.1 0-7Zm0 14c-2.2 2.8-6.2 2.2-7.4-.8-1-2.4.3-5 2.5-6L12 12c-.3 2.6-1.3 5.1 0 7Zm7-7c2.8 2.2 2.2 6.2-.8 7.4-2.4 1-5-.3-6-2.5L12 12c2.6-.3 5.1-1.3 7 0ZM5 12C2.2 9.8 2.8 5.8 5.8 4.6c2.4-1 5 .3 6 2.5L12 12c-2.6.3-5.1 1.3-7 0Z"
      />
    </Glyph>
  )
}

function SwitchIcon() {
  return (
    <Glyph kind="switch">
      <rect x="4.5" y="3.5" width="15" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </Glyph>
  )
}

function CoverIcon() {
  return (
    <Glyph kind="cover">
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path fill="currentColor" d="M5 5h14v5H5z" />
      <path stroke="currentColor" strokeWidth="1.4" d="M12 10v10" />
    </Glyph>
  )
}

function ClimateIcon() {
  return (
    <Glyph kind="climate">
      <path
        fill="currentColor"
        d="M10.2 13.6V6.2a1.8 1.8 0 1 1 3.6 0v7.4a3.5 3.5 0 1 1-3.6 0ZM12 4.8a.6.6 0 0 0-.6.6v8.2l-.5.3a2.3 2.3 0 1 0 2.2 0l-.5-.3V5.4a.6.6 0 0 0-.6-.6Z"
      />
      <path stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M12 8.2v5" />
    </Glyph>
  )
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <Glyph kind={open ? 'lock-open' : 'lock'}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" fill="currentColor" />
      {open ? (
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M8 10.5V6.8a4 4 0 0 1 7.6-1.8" />
      ) : (
        <path fill="none" stroke="currentColor" strokeWidth="1.8" d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      )}
    </Glyph>
  )
}

function SceneIcon() {
  return (
    <Glyph kind="scene">
      <path fill="currentColor" d="M12 2.5 13.8 9H20l-5 3.8L16.8 19 12 15.4 7.2 19 9 12.8 4 9h6.2z" />
    </Glyph>
  )
}

function ScriptIcon() {
  return (
    <Glyph kind="script">
      <path fill="currentColor" d="M8 4.5v15l12-7.5z" />
    </Glyph>
  )
}

function BooleanIcon() {
  return (
    <Glyph kind="input_boolean">
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </Glyph>
  )
}

/** Thin-bezel flat screen with a central stand — Samsung Crystal UHD / CU7000 and most modern sets. */
function TvFlat() {
  return (
    <Glyph kind="tv-flat">
      <rect x="2.5" y="3.5" width="19" height="13.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4" y="5" width="16" height="10.2" rx="0.4" fill="currentColor" opacity="0.22" />
      <path fill="currentColor" d="M11 17.2h2l1.6 3.2H9.4z" />
    </Glyph>
  )
}

/** The Frame: a deeper gallery bezel, no stand, like a picture on the wall. */
function TvFrame() {
  return (
    <Glyph kind="tv-frame">
      <rect x="2.2" y="3.2" width="19.6" height="17.2" rx="0.6" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <rect x="4.6" y="5.6" width="14.8" height="12.4" fill="currentColor" opacity="0.22" />
    </Glyph>
  )
}

/** The Serif: the distinctive I-beam / typographic silhouette. */
function TvSerif() {
  return (
    <Glyph kind="tv-serif">
      <path
        fill="currentColor"
        d="M3 4.2h18v3.2h-3.2v9.2H21v3.2H3v-3.2h3.2V7.4H3V4.2Zm4.6 3.2h8.8v9.2H7.6V7.4Z"
        opacity="0.95"
      />
      <rect x="8.4" y="8.2" width="7.2" height="7.4" fill="currentColor" opacity="0.25" />
    </Glyph>
  )
}

/** The Sero: a taller, portrait-leaning set on a compact stand. */
function TvSero() {
  return (
    <Glyph kind="tv-sero">
      <rect x="5.5" y="2.5" width="13" height="16.2" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="7" y="4" width="10" height="13.2" rx="0.4" fill="currentColor" opacity="0.22" />
      <path fill="currentColor" d="M9 19.2h6l1.4 2.4H7.6z" />
    </Glyph>
  )
}

/** Generic TV fallback: slightly thicker bezel and a wide stand. */
function TvGeneric() {
  return (
    <Glyph kind="tv-generic">
      <rect x="2.5" y="4" width="19" height="12.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4.2" y="5.6" width="15.6" height="9.3" rx="0.4" fill="currentColor" opacity="0.22" />
      <path fill="currentColor" d="M8 17.2h8l1.8 3.3H6.2z" />
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
      return <LightIcon />
    case 'fan':
      return <FanIcon />
    case 'switch':
      return <SwitchIcon />
    case 'input_boolean':
      return <BooleanIcon />
    case 'cover':
      return <CoverIcon />
    case 'climate':
      return <ClimateIcon />
    case 'lock':
      return <LockIcon open={!!entity.on} />
    case 'media_player':
      return <TvIcon entity={entity} />
    case 'scene':
      return <SceneIcon />
    case 'script':
      return <ScriptIcon />
    default:
      return (
        <Glyph kind="unknown">
          <circle cx="12" cy="12" r="6" fill="currentColor" />
        </Glyph>
      )
  }
}
