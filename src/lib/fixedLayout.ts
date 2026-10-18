import type { FoliateBook, TocItem } from './foliate'

// Shared engine for page-image formats (PDF, DjVu) on top of foliate's
// fixed-layout renderer. foliate draws a page only when it is shown and
// throws the result away; here every page is rendered once into an
// ImageBitmap, kept in a small LRU cache, and the neighbours are rendered
// in the background so page turns are usually instant.

export type PageSize = { width: number; height: number }

export interface PageSource {
  count: number
  /** Page size in layout units (PDF points); only the aspect ratio really matters. */
  pageSize(index: number): Promise<PageSize>
  /** Rasterize a page to (about) the given pixel size; reject if `signal` aborts. */
  render(index: number, width: number, height: number, signal?: AbortSignal): Promise<ImageBitmap>
  /** Fill `.textLayer` in the page document so text can be selected. */
  text?(index: number, doc: Document, scale: number): Promise<void>
  /** Plain text of a page, for full-text search. */
  plainText?(index: number): Promise<string>
  /** CSS added to every page document. */
  css?: string
  destroy(): void
}

const CACHE_SIZE = 7
const AHEAD = [1, 2, -1]

class BitmapCache {
  #map = new Map<string, Promise<ImageBitmap>>()

  get(key: string, make: () => Promise<ImageBitmap>) {
    let p = this.#map.get(key)
    if (p) {
      // Re-insert to mark as most recently used.
      this.#map.delete(key)
      this.#map.set(key, p)
      return p
    }
    p = make()
    p.catch(() => this.#map.delete(key))
    this.#map.set(key, p)
    while (this.#map.size > CACHE_SIZE) {
      const [oldKey, old] = this.#map.entries().next().value!
      this.#map.delete(oldKey)
      old.then(b => b.close(), () => {})
    }
    return p
  }

  drop(key: string) { this.#map.delete(key) }

  clear() {
    for (const p of this.#map.values()) p.then(b => b.close(), () => {})
    this.#map.clear()
  }
}

const idle = () => new Promise<void>(resolve =>
  'requestIdleCallback' in window
    ? requestIdleCallback(() => resolve(), { timeout: 300 })
    : setTimeout(resolve, 30))

const escapeHTML = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type FixedBookInfo = {
  metadata: Record<string, unknown>
  toc?: TocItem[]
  resolveHref?: (href: string) => Promise<{ index: number }> | { index: number }
  splitTOCHref?: (href: string) => Promise<[number, null]> | [number, null]
}

export const makeFixedBook = (src: PageSource, info: FixedBookInfo): FoliateBook => {
  const sizes = new Map<number, Promise<PageSize>>()
  const sizeOf = (i: number) => {
    let s = sizes.get(i)
    if (!s) sizes.set(i, s = src.pageSize(i))
    return s
  }
  const cache = new BitmapCache()
  const urls = new Map<number, string>()
  const parser = new DOMParser()
  let generation = 0
  // Background renders in flight, so a page turn can cancel them: pdf.js
  // paints on the main thread and would otherwise delay the page you asked for.
  const background = new Map<number, AbortController>()

  const pixelSize = (size: PageSize, scale: number) => {
    const dpr = Math.min(devicePixelRatio || 1, 3)
    return [Math.max(1, Math.round(size.width * scale * dpr)), Math.max(1, Math.round(size.height * scale * dpr))]
  }

  const bitmap = async (i: number, scale: number, signal?: AbortSignal) => {
    const [w, h] = pixelSize(await sizeOf(i), scale)
    const key = `${i}:${w}x${h}`
    const bmp = await cache.get(key, () => src.render(i, w, h, signal))
    if (bmp.width) return bmp
    // Evicted and closed between resolve and use: render again.
    cache.drop(key)
    return cache.get(key, () => src.render(i, w, h))
  }

  const prefetch = async (i: number, scale: number) => {
    const gen = ++generation
    for (const d of AHEAD) {
      await idle()
      if (gen !== generation) return
      const j = i + d
      if (j < 0 || j >= src.count) continue
      const ac = new AbortController()
      background.set(j, ac)
      await bitmap(j, scale, ac.signal).catch(() => {})
      background.delete(j)
    }
  }

  /** A page was requested: stop rendering anything else in the background. */
  const focusOn = (i: number) => {
    generation++
    for (const [j, ac] of background) if (j !== i) ac.abort()
  }

  const show = async (i: number, doc: Document, scale: number) => {
    doc.documentElement.style.setProperty('--scale-factor', String(scale))
    const bmp = await bitmap(i, scale)
    const canvas = doc.querySelector('canvas')
    if (!canvas || !doc.defaultView) return
    canvas.width = bmp.width
    canvas.height = bmp.height
    canvas.getContext('2d')!.drawImage(bmp, 0, 0)
    prefetch(i, scale)
    // The picture first; the selectable text when the page is idle, so a
    // quick second tap is not held up by text layout.
    const layer = doc.querySelector<HTMLElement>('.textLayer')
    if (src.text && layer && !layer.dataset.ready) {
      layer.dataset.ready = '1'
      await idle()
      if (!doc.defaultView) return
      await src.text(i, doc, scale).catch(e => console.warn('text layer', e))
    }
  }

  const pageURL = async (i: number) => {
    const cached = urls.get(i)
    if (cached) return cached
    const { width, height } = await sizeOf(i)
    const html = `<!DOCTYPE html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=${width}, height=${height}">
<style>
html, body { margin: 0; padding: 0; overflow: hidden; background: #fff; }
:root {
  --user-unit: 1;
  --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
  --scale-round-x: 1px;
  --scale-round-y: 1px;
}
canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
${src.css ?? ''}
</style>
<canvas></canvas>
<div class="textLayer"></div>
<div class="annotationLayer"></div>`
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    urls.set(i, url)
    return url
  }

  const book = {
    // foliate pairs pages into spreads; on a portrait phone only one side is
    // visible, so building both would double the work of every page turn.
    rendition: { layout: 'pre-paginated', spread: innerWidth < innerHeight ? 'none' : 'auto' },
    metadata: info.metadata,
    toc: info.toc,
    dir: 'ltr',
    sections: Array.from({ length: src.count }, (_, i) => ({
      id: i,
      size: 1000,
      linear: 'yes',
      load: async () => ({
        src: (focusOn(i), await pageURL(i)),
        onZoom: ({ doc, scale }: { doc: Document; scale: number }) => {
          show(i, doc, scale).catch(e => console.error(e))
        },
      }),
      createDocument: src.plainText
        ? async () => parser.parseFromString(
          `<html><body><p>${escapeHTML(await src.plainText!(i))}</p></body></html>`, 'text/html')
        : undefined,
    })),
    isExternal: (uri: string) => /^\w+:/i.test(uri),
    resolveHref: info.resolveHref ?? ((href: string) => ({ index: Number(href) })),
    splitTOCHref: info.splitTOCHref ?? ((href: string) => [Number(href), null]),
    getTOCFragment: (doc: Document) => doc.documentElement,
    getCover: async () => {
      const size = await sizeOf(0)
      const w = 360
      const bmp = await src.render(0, w, Math.round(w * size.height / size.width))
      const canvas = new OffscreenCanvas(bmp.width, bmp.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, bmp.width, bmp.height)
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
      return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    },
    destroy: () => {
      generation++
      cache.clear()
      for (const url of urls.values()) URL.revokeObjectURL(url)
      src.destroy()
    },
  }
  return book as unknown as FoliateBook
}
