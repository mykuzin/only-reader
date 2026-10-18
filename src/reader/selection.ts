const BLOCK = 'p, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, pre, figcaption, div, section, body'
const MAX_CONTEXT = 600

/**
 * Returns the sentence(s) around a selection, used to disambiguate
 * the translation ("bank" of a river vs. a bank account).
 */
export const contextOf = (range: Range, lang?: string): string => {
  const start = range.startContainer
  const el = (start.nodeType === Node.ELEMENT_NODE ? start as Element : start.parentElement)
    ?.closest(BLOCK)
  if (!el) return range.toString()

  const text = el.textContent ?? ''
  const before = el.ownerDocument.createRange()
  before.setStart(el, 0)
  try {
    before.setEnd(range.startContainer, range.startOffset)
  } catch {
    return clip(text)
  }
  const selStart = before.toString().length
  const selEnd = selStart + range.toString().length

  // PDF text layers are lots of absolutely positioned spans: rely on the
  // segmenter rather than element boundaries there.
  let sentences: { segment: string; index: number }[]
  try {
    const seg = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' })
    sentences = Array.from(seg.segment(text), s => ({ segment: s.segment, index: s.index }))
  } catch {
    return clip(text)
  }
  const picked = sentences.filter(s =>
    s.index + s.segment.length > selStart && s.index < Math.max(selEnd, selStart + 1))
  const result = (picked.length ? picked.map(s => s.segment).join('') : text).replace(/\s+/g, ' ').trim()
  return clip(result, selStart - (picked[0]?.index ?? 0))
}

const clip = (text: string, focus = 0) => {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= MAX_CONTEXT) return t
  const from = Math.max(0, Math.min(focus - MAX_CONTEXT / 2, t.length - MAX_CONTEXT))
  return (from > 0 ? '…' : '') + t.slice(from, from + MAX_CONTEXT) + (from + MAX_CONTEXT < t.length ? '…' : '')
}

/** Trims whitespace and stray quotes/punctuation picked up by a sloppy long-press. */
export const normalizeSelection = (text: string) =>
  text.replace(/\s+/g, ' ').replace(/^[\s"'“”«»„(\[]+|[\s"'“”«»„)\],;:]+$/g, '').trim()
