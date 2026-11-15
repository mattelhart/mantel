/** Mirrors the server-side palette in backend/app/routers/users.py. */
export const PALETTE = [
  '#3b82f6',
  '#f97316',
  '#22c55e',
  '#a855f7',
  '#ec4899',
  '#eab308',
  '#14b8a6',
  '#ef4444',
]

/** The same eight people, drawn as the soft fills the Airy layout uses for event
 *  pills. Stored colours stay saturated so Midnight, Daylight and Hearth are unchanged. */
export const PASTEL_FOR: Record<string, string> = {
  '#3b82f6': '#b7d4fb',
  '#f97316': '#f6c9a6',
  '#22c55e': '#b7e4c7',
  '#a855f7': '#d4c4f5',
  '#ec4899': '#f6c1d6',
  '#eab308': '#f6e3a4',
  '#14b8a6': '#b7e3dc',
  '#ef4444': '#f6c4c2',
}

/** Pull an arbitrary colour toward white so a custom pick still reads as a pastel. */
export function soften(hex: string): string {
  const h = hex.trim().replace('#', '')
  if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return '#d9e2ef'
  const towardWhite = 0.58
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16)
    return Math.round(v * (1 - towardWhite) + 255 * towardWhite)
  }
  return `#${[0, 2, 4].map((i) => channel(i).toString(16).padStart(2, '0')).join('')}`
}

/** Event and avatar fills. Outside Airy this is the stored colour, unchanged. */
export function eventFill(color: string, airy: boolean): string {
  if (!airy) return color
  const key = color.trim().toLowerCase()
  return PASTEL_FOR[key] ?? soften(key)
}
