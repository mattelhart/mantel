import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'

/* Shared "get out of this panel" behaviour for every dialog, side panel and sheet.
 *
 *  - A tap on the dimmed area outside the card dismisses it, and is consumed: whatever
 *    sits underneath the tap is not activated.
 *  - A panel with unsaved edits asks "Save changes?" first, for the outside tap, Escape,
 *    the Samsung Back key (which the TV layer turns into Escape) and Cancel/X alike.
 *
 * Why pointer events instead of a plain `click` on the backdrop: a finger on a wall
 * touchscreen rarely lands without sliding a little, and the browser only sends `click`
 * when the slide is under about 15px. A sloppy tap on the dimmed area was simply
 * ignored, which reads as "tapping outside doesn't close it". Pointer up still arrives. */

/** How far a finger may slide and still count as a tap, in CSS pixels. */
export const TAP_SLOP_PX = 32
/** Longer than this is a press-and-hold, not a tap. */
export const TAP_MAX_MS = 800
/** How long after a dismissing tap the browser's follow-up mouse/click events are eaten. */
export const TAP_THROUGH_GUARD_MS = 400

/**
 * Closing on pointer-up removes the backdrop before the browser sends the `click` that
 * belongs to the same tap, so that click would land on the calendar slot (or on a button
 * of the confirmation that just opened) under the finger. Swallow the follow-up events
 * for a moment. The first click ends the guard early; the timer covers a tap that
 * produces none.
 */
export function swallowTapThrough(ms = TAP_THROUGH_GUARD_MS): void {
  const types = ['mousedown', 'mouseup', 'click'] as const
  const eat = (event: Event) => {
    event.stopPropagation()
    event.preventDefault()
    if (event.type === 'click') stop()
  }
  let timer: ReturnType<typeof setTimeout>
  const stop = () => {
    clearTimeout(timer)
    for (const type of types) window.removeEventListener(type, eat, true)
  }
  for (const type of types) window.addEventListener(type, eat, true)
  timer = setTimeout(stop, ms)
}

export interface DismissGuardOptions {
  /** Edits that would be lost: the current values differ from the opening ones. */
  dirty: boolean
  /** The panel's normal Save, validation included. Resolve true when it saved and
   *  closed the panel; false when it refused (the panel stays open and shows why). */
  save?: () => Promise<boolean>
  onClose: () => void
  /** A save or delete is in flight; dismissing now would orphan it. */
  busy?: boolean
}

export function useDismissGuard({ dirty, save, onClose, busy = false }: DismissGuardOptions) {
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  // Latest values for the window listener, which is installed once.
  const live = useRef({ dirty, busy, confirming, onClose })
  live.current = { dirty, busy, confirming, onClose }
  const returnFocus = useRef<HTMLElement | null>(null)

  const requestClose = useCallback(() => {
    const { dirty, busy, confirming, onClose } = live.current
    if (busy || confirming) return
    if (!dirty) return onClose()
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirming(true)
  }, [])

  const keepEditing = useCallback(() => setConfirming(false), [])
  const discard = useCallback(() => {
    setConfirming(false)
    live.current.onClose()
  }, [])
  const saveAndClose = useCallback(async () => {
    if (!save) return
    setSaving(true)
    try {
      // On success the panel's own save has already closed it.
      if (!(await save())) setConfirming(false)
    } catch {
      setConfirming(false)
    } finally {
      setSaving(false)
    }
  }, [save])

  // Escape, and the TV layer's Back key (it re-dispatches Escape on window).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (live.current.confirming) setConfirming(false)
      else requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  // Put focus back where it was when "Keep editing" is chosen, so the D-pad carries on
  // from the field it left.
  const wasConfirming = useRef(false)
  useLayoutEffect(() => {
    if (wasConfirming.current && !confirming) {
      const target = returnFocus.current
      if (target?.isConnected) target.focus({ preventScroll: true })
    }
    wasConfirming.current = confirming
  }, [confirming])

  const down = useRef<{ id: number; x: number; y: number; at: number } | null>(null)
  const tappedAt = useRef(-Infinity)
  const backdropProps = {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      down.current =
        event.target === event.currentTarget
          ? { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp }
          : null
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const start = down.current
      down.current = null
      if (!start || event.target !== event.currentTarget || event.pointerId !== start.id) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return
      if (event.timeStamp - start.at > TAP_MAX_MS) return
      tappedAt.current = event.timeStamp
      swallowTapThrough()
      requestClose()
    },
    onPointerCancel() {
      down.current = null
    },
    // A click with no pointer tap just before it: a keyboard- or script-driven click, or a
    // browser with no pointer events. Same meaning.
    onClick(event: ReactMouseEvent<HTMLElement>) {
      if (event.target !== event.currentTarget) return
      event.stopPropagation()
      if (event.timeStamp - tappedAt.current < TAP_THROUGH_GUARD_MS) return
      requestClose()
    },
  }

  return {
    requestClose,
    backdropProps,
    /** Render `<UnsavedChangesPrompt {...promptProps} />` inside the dialog when true,
     *  and put `inert` on the form card so focus cannot wander behind it. */
    confirming,
    promptProps: { saving, canSave: !!save, onSave: saveAndClose, onDiscard: discard, onKeepEditing: keepEditing },
  }
}

export interface UnsavedChangesPromptProps {
  saving: boolean
  canSave: boolean
  onSave: () => void
  onDiscard: () => void
  onKeepEditing: () => void
}

/** "Save changes?" Large buttons, Save first and focused, stacked so Up/Down on a remote
 *  moves through them. Lives inside the dialog element so the TV layer's focus
 *  containment (it scopes to the first [role=dialog]) covers it. */
export function UnsavedChangesPrompt({ saving, canSave, onSave, onDiscard, onKeepEditing }: UnsavedChangesPromptProps) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const el = first.current ?? undefined
    el?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="unsaved" role="presentation" onClick={(e) => e.target === e.currentTarget && !saving && onKeepEditing()}>
      <div className="unsaved__card" role="alertdialog" aria-modal="true" aria-labelledby="unsaved-title">
        <h2 id="unsaved-title" className="modal__title">Save changes?</h2>
        <p className="modal__note">You have edits that haven't been saved.</p>
        {canSave && (
          <button ref={first} type="button" className="btn btn--primary unsaved__btn" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
        <button ref={canSave ? undefined : first} type="button" className="btn btn--danger unsaved__btn" onClick={onDiscard} disabled={saving}>
          Discard
        </button>
        <button type="button" className="btn unsaved__btn" onClick={onKeepEditing} disabled={saving}>
          Keep editing
        </button>
      </div>
    </div>
  )
}
