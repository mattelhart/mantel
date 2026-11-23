// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { TAP_THROUGH_GUARD_MS, UnsavedChangesPrompt, useDismissGuard } from './dismissGuard'
import { byText, click, flush, key, mount, pointer, tapPointer, type, unmount } from './testDom'

function Panel({ save, onClose, onUnderneath }: {
  save?: () => Promise<boolean>
  onClose: () => void
  onUnderneath: () => void
}) {
  const [value, setValue] = useState('')
  const guard = useDismissGuard({ dirty: value !== '', save, onClose })
  return (
    <>
      <button data-testid="under" onClick={onUnderneath}>under</button>
      <div className="modal" role="dialog" data-testid="backdrop" {...guard.backdropProps}>
        <div className="modal__card" inert={guard.confirming}>
          <input data-testid="field" value={value} onChange={(e) => setValue(e.target.value)} />
          <button onClick={guard.requestClose}>Cancel</button>
        </div>
        {guard.confirming && <UnsavedChangesPrompt {...guard.promptProps} />}
      </div>
    </>
  )
}

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)!
const edit = () => type(q('field') as HTMLInputElement, 'x')
const prompt = () => document.querySelector('[role="alertdialog"]')

describe('dismiss guard', () => {
  let onClose: Mock<() => void>
  let under: Mock<() => void>
  let save: Mock<() => Promise<boolean>>
  const open = (withSave = true) => mount(<Panel save={withSave ? save : undefined} onClose={onClose} onUnderneath={under} />)

  beforeEach(() => {
    vi.useFakeTimers()
    onClose = vi.fn()
    under = vi.fn()
    save = vi.fn(async () => true)
  })
  afterEach(() => {
    unmount()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('closes on a tap outside the card when nothing was edited, with no prompt', () => {
    open()
    tapPointer(q('backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
    expect(prompt()).toBeNull()
  })

  it('still counts a tap where the finger slid, which the browser would not call a click', () => {
    open()
    tapPointer(q('backdrop'), 20)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores a drag, a tap that started inside the card, and a cancelled gesture', () => {
    open()
    tapPointer(q('backdrop'), 200)
    pointer(q('field'), 'pointerdown')
    pointer(q('backdrop'), 'pointerup')
    pointer(q('backdrop'), 'pointerdown')
    pointer(q('backdrop'), 'pointercancel')
    pointer(q('backdrop'), 'pointerup')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not close for a tap on the card itself', () => {
    open()
    tapPointer(q('field'))
    click(q('field'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('also closes for a plain click on the backdrop (keyboard or script driven)', () => {
    open()
    click(q('backdrop'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('consumes the tap: the click that follows it does not reach what is underneath', () => {
    open()
    tapPointer(q('backdrop'))
    // The overlay is gone by now, so the browser's follow-up click lands on the page.
    click(q('under'))
    expect(under).not.toHaveBeenCalled()
    // Only that one click: the next real tap works.
    click(q('under'))
    expect(under).toHaveBeenCalledOnce()
  })

  it('stops eating clicks once the guard window has passed', () => {
    open()
    tapPointer(q('backdrop'))
    vi.advanceTimersByTime(TAP_THROUGH_GUARD_MS + 10)
    click(q('under'))
    expect(under).toHaveBeenCalledOnce()
  })

  it('a clean Cancel closes at once', () => {
    open()
    click(byText('Cancel')!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  describe('with unsaved edits', () => {
    it.each([
      ['an outside tap', () => tapPointer(q('backdrop'))],
      ['Escape', () => key('Escape')],
      ['Cancel', () => click(byText('Cancel')!)],
    ])('asks "Save changes?" for %s instead of closing', (_name, dismiss) => {
      open()
      edit()
      dismiss()
      expect(onClose).not.toHaveBeenCalled()
      expect(prompt()?.textContent).toContain('Save changes?')
      expect(byText('Save')).toBeTruthy()
      expect(byText('Discard')).toBeTruthy()
      expect(byText('Keep editing')).toBeTruthy()
    })

    it('puts focus on Save and makes the form behind it inert for the D-pad', () => {
      open()
      edit()
      key('Escape')
      expect(document.activeElement).toBe(byText('Save'))
      expect(q('backdrop').querySelector('.modal__card')!.hasAttribute('inert')).toBe(true)
      // The prompt is inside the dialog element, which is what the TV layer scopes to.
      expect(q('backdrop').contains(prompt())).toBe(true)
    })

    it('does not let the tap that opened the prompt press a button in it', () => {
      open()
      edit()
      tapPointer(q('backdrop'))
      // The browser's compat click lands where the finger is: on the prompt's scrim.
      click(byText('Discard')!)
      expect(onClose).not.toHaveBeenCalled()
      expect(prompt()).not.toBeNull()
    })

    it('Save runs the normal save and leaves closing to it', async () => {
      open()
      edit()
      key('Escape')
      click(byText('Save')!)
      await flush()
      expect(save).toHaveBeenCalledOnce()
    })

    it('Save that fails keeps the panel open and drops the prompt', async () => {
      save.mockResolvedValueOnce(false)
      open()
      edit()
      key('Escape')
      click(byText('Save')!)
      await flush()
      expect(onClose).not.toHaveBeenCalled()
      expect(prompt()).toBeNull()
      expect(q('field')).toBeTruthy()
    })

    it('Save that throws also keeps the panel open', async () => {
      save.mockRejectedValueOnce(new Error('boom'))
      open()
      edit()
      key('Escape')
      click(byText('Save')!)
      await flush()
      expect(prompt()).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('Discard closes without saving', () => {
      open()
      edit()
      key('Escape')
      click(byText('Discard')!)
      expect(onClose).toHaveBeenCalledOnce()
      expect(save).not.toHaveBeenCalled()
    })

    it('Keep editing returns to the form, keeps the edit and the focus', () => {
      open()
      edit()
      ;(q('field') as HTMLElement).focus()
      key('Escape')
      click(byText('Keep editing')!)
      expect(prompt()).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
      expect((q('field') as HTMLInputElement).value).toBe('x')
      expect(document.activeElement).toBe(q('field'))
      expect(q('backdrop').querySelector('.modal__card')!.hasAttribute('inert')).toBe(false)
    })

    it('Escape on the prompt means Keep editing', () => {
      open()
      edit()
      key('Escape')
      key('Escape')
      expect(prompt()).toBeNull()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('a tap beside the prompt means Keep editing, and Discard still works afterwards', () => {
      open()
      edit()
      key('Escape')
      click(document.querySelector('.unsaved')!)
      expect(prompt()).toBeNull()
      key('Escape')
      click(byText('Discard')!)
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('offers only Discard and Keep editing when the panel has no save', () => {
      open(false)
      edit()
      key('Escape')
      expect(byText('Save')).toBeUndefined()
      expect(document.activeElement).toBe(byText('Discard'))
    })
  })
})
