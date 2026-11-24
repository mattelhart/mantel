/** Reserve room for Homie and his props. An empty-looking day button still owns its entire hit area. */
export function findHomieSpot() {
  const main = document.querySelector('main')
  if (!main) return null
  const area = main.getBoundingClientRect()
  const left = Math.max(0, area.left), right = Math.min(innerWidth, area.right)
  const top = Math.max(0, area.top), bottom = Math.min(innerHeight, area.bottom)
  const occupied = Array.from(document.querySelectorAll(
    'button,a,input,select,textarea,[role="button"],[tabindex],img,svg,canvas,video,iframe,[contenteditable="true"]',
  )).filter(el => !el.closest('.homie-yard')).map(el => el.getBoundingClientRect())
  const words = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  while (words.nextNode()) {
    if (!words.currentNode.textContent?.trim()) continue
    range.selectNodeContents(words.currentNode)
    occupied.push(...Array.from(range.getClientRects()))
  }
  const spots = []
  for (let y = top + 12; y + 72 < bottom; y += 64) {
    for (let x = left + 12; x + 92 < right; x += 80) {
      if (!occupied.some(r => r.width && r.height && r.left < x + 92 && r.right > x && r.top < y + 72 && r.bottom > y)) {
        const surface = document.elementFromPoint(x + 46, y + 36)
        if (surface && main.contains(surface)) spots.push({ x: x + 17, y: y + 7 })
      }
    }
  }
  return spots[Math.floor(Math.random() * spots.length)] ?? null
}
