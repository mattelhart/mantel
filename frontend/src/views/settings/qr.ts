const SVG_NS = 'http://www.w3.org/2000/svg'

/** An SVG string as a data: URI an <img> will actually draw. An <img> needs the document to
 *  declare its namespace, and the server's QR once came without it (an inline-HTML snippet),
 *  which shows as a broken image. Add the namespace and a viewBox (so CSS can size it) when
 *  they are missing; a complete document passes through untouched. */
export function qrDataUri(svg: string): string {
  let doc = svg.trim()
  if (!/^<svg\b[^>]*\sxmlns=/.test(doc)) doc = doc.replace(/^<svg\b/, `<svg xmlns="${SVG_NS}"`)
  const open = /^<svg\b[^>]*>/.exec(doc)?.[0] ?? ''
  if (open && !/\sviewBox=/.test(open)) {
    const w = /\swidth="(\d+(?:\.\d+)?)"/.exec(open)?.[1]
    const h = /\sheight="(\d+(?:\.\d+)?)"/.exec(open)?.[1]
    if (w && h) doc = doc.replace(/^<svg\b/, `<svg viewBox="0 0 ${w} ${h}"`)
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(doc)}`
}

/** A phone cannot reach "localhost": a QR made while this screen is open under that name
 *  would point the phone at itself. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h)
}
