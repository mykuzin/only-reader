import { makeFixedBook, type PageSource } from './fixedLayout'
import type { DjvuOps } from './djvu.worker'

export const isDjVu = async (file: Blob) => {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  return String.fromCharCode(...head) === 'AT&TFORM'
}

type Remote = { [K in keyof DjvuOps]: (...a: Parameters<DjvuOps[K]>) => ReturnType<DjvuOps[K]> }

const startWorker = () => {
  const worker = new Worker(new URL('./djvu.worker.ts', import.meta.url), { type: 'module' })
  let next = 0
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  worker.onmessage = ({ data: { id, result, error } }) => {
    const p = pending.get(id)
    pending.delete(id)
    if (error) p?.reject(new Error(error))
    else p?.resolve(result)
  }
  const remote = new Proxy({}, {
    get: (_, op: string) => (...args: unknown[]) => new Promise((resolve, reject) => {
      const id = next++
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, op, args })
    }),
  }) as Remote
  return { remote, terminate: () => worker.terminate() }
}

// Invisible, selectable words laid over the page image (like pdf.js's text layer).
const TEXT_CSS = `
.textLayer { position: absolute; inset: 0; overflow: hidden; line-height: 1; }
.textLayer span {
  position: absolute; white-space: pre; color: transparent; transform-origin: 0 0;
  font-family: sans-serif; cursor: text;
}
.textLayer ::selection { background: rgba(0, 100, 255, .25); }
`

export const makeDjvuBook = async (file: File) => {
  const { remote, terminate } = startWorker()
  let opened: { count: number; text: boolean }
  try {
    opened = await remote.open(file)
  } catch (e) {
    terminate()
    throw e
  }

  const infos = new Map<number, Promise<number[]>>()
  const info = (i: number) => {
    let p = infos.get(i)
    if (!p) infos.set(i, p = remote.info(i))
    return p
  }

  const source: PageSource = {
    count: opened.count,
    css: TEXT_CSS,
    pageSize: async i => {
      // Express pages in points, like PDF, so both formats zoom the same way.
      const [w, h, dpi] = await info(i)
      return { width: (w / dpi) * 72, height: (h / dpi) * 72 }
    },
    render: async (i, width) => {
      const [w, , dpi] = await info(i)
      // Never decode above the scan's own resolution; CSS scales up the rest.
      const target = Math.max(24, Math.min(dpi, Math.round(dpi * width / w)))
      return remote.render(i, target)
    },
    text: opened.text ? async (i, doc) => {
      const [w, h, dpi] = await info(i)
      const zones = await remote.zones(i, dpi)
      const layer = doc.querySelector<HTMLElement>('.textLayer')
      if (!zones.length || !layer) return
      const spans = zones.map(z => {
        const span = doc.createElement('span')
        span.textContent = `${z.t} `
        Object.assign(span.style, {
          left: `${(z.x / w) * 100}%`,
          top: `${(z.y / h) * 100}%`,
          fontSize: `calc(var(--scale-factor) * ${((z.h / dpi) * 72 * 0.9).toFixed(2)}px)`,
        })
        return span
      })
      layer.append(...spans)
      // Stretch each word to its box: measure everything, then write (one reflow).
      const pageWidth = layer.getBoundingClientRect().width
      const widths = spans.map(s => s.getBoundingClientRect().width)
      spans.forEach((s, k) => {
        const target = ((zones[k].w / w) * pageWidth) * (1 + 1 / Math.max(1, zones[k].t.length))
        if (widths[k] > 0) s.style.transform = `scaleX(${target / widths[k]})`
      })
    } : undefined,
    plainText: opened.text ? i => remote.text(i) : undefined,
    destroy: terminate,
  }

  return makeFixedBook(source, {
    metadata: { title: file.name.replace(/\.(djvu?|djv)$/i, '') },
  })
}
