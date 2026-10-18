/// <reference lib="webworker" />
import init, { WasmDocument, WasmLazyDocument } from 'djvu-rs'

// Decoding DjVu is CPU-heavy, so it runs here instead of on the UI thread.

declare const self: DedicatedWorkerGlobalScope

/** Above this size, pages are fetched lazily from the File (no text layer). */
const FULL_LOAD_LIMIT = 80 * 1024 * 1024

type Zone = { t: string; x: number; y: number; w: number; h: number }

let full: WasmDocument | null = null
let lazy: WasmLazyDocument | null = null

const toBitmap = (pixels: Uint8ClampedArray, w: number, h: number) =>
  createImageBitmap(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, w, h))

const ops = {
  async open(file: File) {
    await init()
    if (file.size <= FULL_LOAD_LIMIT) {
      full = WasmDocument.from_bytes(new Uint8Array(await file.arrayBuffer()))
      return { count: full.page_count(), text: true }
    }
    lazy = await WasmLazyDocument.open(file.size, async (offset: number, len: number) =>
      new Uint8Array(await file.slice(offset, offset + len).arrayBuffer()))
    return { count: lazy.page_count(), text: false }
  },

  /** [width px, height px, dpi] at the page's native resolution. */
  async info(i: number) {
    if (full) {
      const page = full.page(i)
      try {
        const dpi = page.dpi()
        return [page.width_at(dpi), page.height_at(dpi), dpi]
      } finally { page.free() }
    }
    return Array.from(await lazy!.page_info(i))
  },

  async render(i: number, dpi: number) {
    if (full) {
      const page = full.page(i)
      try {
        return await toBitmap(page.render(dpi), page.width_at(dpi), page.height_at(dpi))
      } finally { page.free() }
    }
    const pm = await lazy!.render_page(i, dpi)
    try {
      return await toBitmap(pm.to_bytes(), pm.width(), pm.height())
    } finally { pm.free() }
  },

  async zones(i: number, dpi: number): Promise<Zone[]> {
    if (!full) return []
    const page = full.page(i)
    try {
      const json = page.text_zones_json(dpi)
      return json ? JSON.parse(json) : []
    } finally { page.free() }
  },

  async text(i: number) {
    if (!full) return ''
    const page = full.page(i)
    try { return page.text() ?? '' } finally { page.free() }
  },
}

export type DjvuOps = typeof ops

self.onmessage = async ({ data: { id, op, args } }: MessageEvent<{ id: number; op: keyof DjvuOps; args: unknown[] }>) => {
  try {
    const result = await (ops[op] as (...a: unknown[]) => Promise<unknown>)(...args)
    self.postMessage({ id, result }, result instanceof ImageBitmap ? [result] : [])
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) })
  }
}
