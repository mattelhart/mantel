export type Direction = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
type Rect = { left: number; top: number; width: number; height: number }

export function directionalScore(from: Rect, to: Rect, direction: Direction): number {
  const dx = to.left + to.width / 2 - from.left - from.width / 2
  const dy = to.top + to.height / 2 - from.top - from.height / 2
  const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight'
  const forward = direction === 'ArrowRight' ? dx : direction === 'ArrowLeft' ? -dx : direction === 'ArrowDown' ? dy : -dy
  if (forward <= 1) return Infinity
  const cross = Math.abs(horizontal ? dy : dx)
  return forward + cross * 3
}

function arrowDirection(event: KeyboardEvent): Direction | undefined {
  switch (event.keyCode) {
    case 37: return 'ArrowLeft'
    case 38: return 'ArrowUp'
    case 39: return 'ArrowRight'
    case 40: return 'ArrowDown'
  }
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'ArrowRight':
    case 'ArrowDown': return event.key
  }
}
export function installTvNavigation() {
  if (new URLSearchParams(location.search).get('tv') === '1') sessionStorage.setItem('mantel.tv', '1')
  if (sessionStorage.getItem('mantel.tv') !== '1') return
  document.documentElement.dataset.tv = 'true'
  const selector = 'button, a[href], input, select, textarea, [tabindex="0"]'
  let initialFocus = true
  let beforeDialog: HTMLElement | null = null
  let lastDialog: Element | null = null
  document.addEventListener('focusin', event => {
    if (!document.querySelector('[role="dialog"], dialog[open]')) beforeDialog = event.target as HTMLElement
  })

  let remoteDialog: HTMLDialogElement | null = null

  function openChoices(title: string, choices: { label: string; action: () => void }[], initial = 0) {
    const dialog = document.createElement('dialog')
    dialog.className = 'tv-choices'
    dialog.setAttribute('aria-label', title)
    const heading = document.createElement('h2')
    heading.textContent = title
    dialog.append(heading)
    const buttons = choices.map(({ label, action }) => {
      const button = document.createElement('button')
      button.textContent = label
      button.onclick = () => { closeChoices(); action() }
      dialog.append(button)
      return button
    })
    document.body.append(dialog)
    remoteDialog = dialog
    dialog.showModal()
    buttons[initial]?.focus()
  }

  function closeChoices() {
    remoteDialog?.close()
    remoteDialog?.remove()
    remoteDialog = null
    beforeDialog?.focus()
  }

  function candidates(): HTMLElement[] {
    const scope = remoteDialog || document.querySelector('[role="dialog"], dialog[open]') || document
    return Array.from(scope.querySelectorAll<HTMLElement>(selector)).filter(el => {
      if (el.closest('.month') &&
          (!el.matches('.month__addlayer') || el.closest('[data-outside="true"]'))) return false
      const style = getComputedStyle(el)
      return !el.matches(':disabled') && !el.closest('[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"]') && el.tabIndex >= 0 &&
        style.visibility !== 'hidden' && style.display !== 'none' && el.getClientRects().length > 0
    })
  }
  function recoverFocus() {
    const dialog = document.querySelector('[role="dialog"], dialog[open]')
    if (!dialog && lastDialog && beforeDialog?.isConnected) beforeDialog.focus()
    lastDialog = dialog
    const items = candidates()
    if (initialFocus) {
      const calendar = items.find(item => item.matches('.shell__nav a[href^="/calendar"]'))
      if (calendar) {
        initialFocus = false
        calendar.focus({ preventScroll: true })
        return
      }
    }
    if (!items.includes(document.activeElement as HTMLElement)) items[0]?.focus()
  }
  recoverFocus()
  const observer = new MutationObserver(recoverFocus)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'inert', 'aria-hidden', 'aria-disabled'] })
  window.addEventListener('keydown', event => {
    const current = document.activeElement as HTMLElement
    if (document.querySelector('.saver') && (['Escape', 'Enter'].includes(event.key) || [13, 10009].includes(event.keyCode))) {
      event.stopImmediatePropagation()
      event.preventDefault()
      if (!event.repeat) window.dispatchEvent(new Event('mantel:dismiss-saver'))
      return
    }
    const editing = current?.matches('input:not([type="checkbox"]):not([type="radio"]), textarea')
    if ((event.key === 'Enter' || event.keyCode === 13) && current instanceof HTMLSelectElement && !current.multiple) {
      event.preventDefault()
      const options = Array.from(current.options).filter(option => !option.disabled && !option.closest('optgroup:disabled'))
      openChoices(current.labels?.[0]?.textContent?.trim() || current.getAttribute('aria-label') || 'Choose an option',
        options.map(option => ({
          label: option.label,
          action: () => {
            if (current.value === option.value) return
            current.value = option.value
            current.dispatchEvent(new Event('change', { bubbles: true }))
          },
        })), Math.max(0, options.findIndex(option => option.selected)))
      return
    }
    if (event.keyCode === 10009 || event.key === 'Escape') {
      event.preventDefault()
      if (event.repeat) return
      if (remoteDialog) { closeChoices(); return }
      if (editing) {
        const items = candidates()
        const next = items[items.indexOf(current) + 1] || items[0]
        next?.focus()
        return
      }
      if (document.querySelector('[role="dialog"], dialog[open]')) {
        if (event.key !== 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        return
      }
      if (current.closest('.month')) {
        document.querySelector<HTMLElement>('.viewtabs [aria-current="page"]')?.focus()
        return
      }
      if (window.parent !== window) openChoices('Leave the calendar?', [
        { label: 'Keep using Homie', action: () => {} },
        { label: 'Leave calendar', action: () => window.parent.postMessage({ type: 'mantel:back' }, '*') },
      ])
      return
    }
    const direction = arrowDirection(event)
    if (!direction) return
    // Preserve caret movement and native pickers; vertical arrows leave a single-line field.
    if (editing && (current.matches('textarea, select, input[type="date"], input[type="datetime-local"], input[type="time"]') ||
      direction === 'ArrowLeft' || direction === 'ArrowRight')) return
    event.preventDefault()
    const items = candidates()
    if (!items.includes(current)) { items[0]?.focus(); return }
    if (direction === 'ArrowRight' && current.closest('.shell__nav') && !remoteDialog) {
      const pageControls = items.filter(item => item.closest('.shell__main, .airybar'))
      pageControls.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
        a.getBoundingClientRect().left - b.getBoundingClientRect().left)
      pageControls[0]?.focus()
      return
    }
    if (current.matches('.month__addlayer')) {
      const days = items.filter(item => item.matches('.month__addlayer'))
      const step = { ArrowUp: -7, ArrowDown: 7, ArrowLeft: -1, ArrowRight: 1 }[direction]
      const next = days[days.indexOf(current) + step]
      next?.focus({ preventScroll: true })
      next?.closest('.month__cell')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return
    }
    const rect = current.getBoundingClientRect()
    const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight'
    const group = current.closest(horizontal
      ? '.airybar__people, .week-layout, [role="tablist"]'
      : 'nav, .week-cards__day')
    const findNext = (choices: HTMLElement[]) => {
      let best: HTMLElement | undefined
      let score = Infinity
      for (const item of choices) {
        const next = directionalScore(rect, item.getBoundingClientRect(), direction)
        if (next < score) { best = item; score = next }
      }
      return best
    }
    const nearby = group ? findNext(items.filter(item => group.contains(item))) : undefined
    const best = nearby ?? findNext(items)
    best?.focus({ preventScroll: true })
    best?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
  if (window.parent !== window) window.parent.postMessage({ type: 'mantel:ready' }, '*')
}
