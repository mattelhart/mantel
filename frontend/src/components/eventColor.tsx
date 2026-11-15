import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { eventFill } from '../views/settings/palette'

interface EventColor {
  airy: boolean
  fill: (color: string) => string
}

const EventColorContext = createContext<EventColor>({
  airy: false,
  fill: (color) => color,
})

/** Pastel fills while Airy is on; the stored colour everywhere else. Pages that
 *  render outside the provider (tests) keep the stored colour. */
export function EventColorProvider({ airy, children }: { airy: boolean; children: ReactNode }) {
  const value = useMemo<EventColor>(
    () => ({ airy, fill: (color) => eventFill(color, airy) }),
    [airy],
  )
  return <EventColorContext.Provider value={value}>{children}</EventColorContext.Provider>
}

export function useEventColor(): (color: string) => string {
  return useContext(EventColorContext).fill
}

export function useAiryTheme(): boolean {
  return useContext(EventColorContext).airy
}
