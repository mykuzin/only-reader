import { putBook, getBook, type BookRecord } from './db'
import { formatContributors, formatLanguageMap, loadView, type FoliateBook } from './foliate'
import { isTxt, makeTxtBook } from './txt'
import { isPDF, makePdfBook } from './pdf'
import { isDjVu, makeDjvuBook } from './djvu'

export const ACCEPT = '.epub,.pdf,.djvu,.djv,.fb2,.fbz,.fb2.zip,.mobi,.azw,.azw3,.kf8,.prc,.cbz,.txt'

const formatOf = (name: string) => {
  const n = name.toLowerCase()
  if (n.endsWith('.fb2.zip') || n.endsWith('.fbz')) return 'FB2'
  const ext = n.split('.').pop() ?? ''
  return ({ prc: 'MOBI', kf8: 'AZW3', djv: 'DJVU' } as Record<string, string>)[ext] ?? ext.toUpperCase()
}

/** Parses a stored or freshly picked file into a foliate book object. */
export const parseBook = async (file: File): Promise<FoliateBook> => {
  if (isTxt(file)) return makeTxtBook(file)
  // Page-image formats use our own cached, prefetching renderer.
  if (await isPDF(file)) return makePdfBook(file)
  if (await isDjVu(file)) return makeDjvuBook(file)
  const { makeBook } = await loadView()
  return makeBook(file)
}

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

// Web Crypto only exists in secure contexts; plain-http LAN testing falls back to FNV-1a.
const digest = async (data: Uint8Array<ArrayBuffer>) => {
  if (crypto.subtle) return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
  let out = ''
  for (let seed = 0; seed < 4; seed++) {
    let h = 0x811c9dc5 ^ seed
    for (const b of data) h = Math.imul(h ^ b, 0x01000193)
    out += (h >>> 0).toString(16).padStart(8, '0')
  }
  return out
}

/** Stable id from content, so re-importing the same file keeps progress. */
const fileId = async (file: File) => {
  const head = await file.slice(0, 256 * 1024).arrayBuffer()
  const tail = await file.slice(Math.max(0, file.size - 64 * 1024)).arrayBuffer()
  const bytes = new Uint8Array(head.byteLength + tail.byteLength + 8)
  bytes.set(new Uint8Array(head), 0)
  bytes.set(new Uint8Array(tail), head.byteLength)
  new DataView(bytes.buffer).setFloat64(head.byteLength + tail.byteLength, file.size)
  return (await digest(bytes)).slice(0, 32)
}

const thumbnail = async (blob: Blob, width = 360): Promise<Blob | undefined> => {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, width / bitmap.width)
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  } catch {
    return undefined
  }
}

export type ImportResult = { book?: BookRecord; error?: string; name: string; existing?: boolean }

export const importFile = async (file: File): Promise<ImportResult> => {
  const name = file.name
  try {
    const id = await fileId(file)
    const existing = await getBook(id)
    if (existing) return { book: existing, name, existing: true }

    const parsed = await parseBook(file)
    const title = formatLanguageMap(parsed.metadata?.title).trim()
      || name.replace(/\.(fb2\.zip|[^.]+)$/i, '')
    const cover = await Promise.resolve(parsed.getCover?.()).catch(() => null)
    const book: BookRecord = {
      id,
      title,
      author: formatContributors(parsed.metadata?.author).trim(),
      language: formatLanguageMap(parsed.metadata?.language) || undefined,
      format: formatOf(name),
      fileName: name,
      size: file.size,
      addedAt: Date.now(),
      cover: cover ? await thumbnail(cover) : undefined,
    }
    parsed.destroy?.()
    // Persist as a File so the name (used for format detection) survives.
    const stored = file instanceof File ? file : new File([file], name)
    await putBook(book, stored)
    return { book, name }
  } catch (e) {
    console.error(e)
    const msg = (e as Error)?.name === 'UnsupportedTypeError' || /not supported/i.test(String(e))
      ? 'This format is not supported.'
      : 'Could not open this file.'
    return { error: msg, name }
  }
}

export const requestPersistentStorage = async () => {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted()))
      await navigator.storage.persist()
  } catch { /* not supported */ }
}
