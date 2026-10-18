import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export type BookRecord = {
  id: string
  title: string
  author: string
  format: string
  fileName: string
  size: number
  addedAt: number
  openedAt?: number
  /** Reading position as an EPUB CFI (foliate fakes CFIs for other formats). */
  location?: string
  progress?: number
  cover?: Blob
  language?: string
}

export type TranslationResult = {
  translation: string
  lemma?: string
  partOfSpeech?: string
  transcription?: string
  alternatives?: string[]
  note?: string
  sourceLanguage?: string
}

export type Lookup = {
  id: string
  bookId: string
  bookTitle: string
  text: string
  context: string
  cfi?: string
  sectionIndex?: number
  targetLang: string
  result: TranslationResult
  createdAt: number
}

interface ReaderDB extends DBSchema {
  books: { key: string; value: BookRecord }
  files: { key: string; value: { id: string; file: File } }
  lookups: { key: string; value: Lookup; indexes: { byBook: string; byDate: number } }
  cache: { key: string; value: { key: string; result: TranslationResult; at: number } }
  /** Files received through the Web Share Target, waiting to be imported. */
  inbox: { key: number; value: { file: File } }
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | undefined

export const db = () => dbPromise ??= openDB<ReaderDB>('only-reader', 1, {
  upgrade(d) {
    d.createObjectStore('books', { keyPath: 'id' })
    d.createObjectStore('files', { keyPath: 'id' })
    const lookups = d.createObjectStore('lookups', { keyPath: 'id' })
    lookups.createIndex('byBook', 'bookId')
    lookups.createIndex('byDate', 'createdAt')
    d.createObjectStore('cache', { keyPath: 'key' })
    d.createObjectStore('inbox', { autoIncrement: true })
  },
})

export const listBooks = async () => {
  const books = await (await db()).getAll('books')
  return books.sort((a, b) => (b.openedAt ?? b.addedAt) - (a.openedAt ?? a.addedAt))
}

export const getBook = async (id: string) => (await db()).get('books', id)
export const getBookFile = async (id: string) => (await (await db()).get('files', id))?.file

export const putBook = async (book: BookRecord, file?: File) => {
  const d = await db()
  const tx = d.transaction(['books', 'files'], 'readwrite')
  await tx.objectStore('books').put(book)
  if (file) await tx.objectStore('files').put({ id: book.id, file })
  await tx.done
}

export const updateBook = async (id: string, patch: Partial<BookRecord>) => {
  const d = await db()
  const book = await d.get('books', id)
  if (book) await d.put('books', { ...book, ...patch })
}

export const deleteBook = async (id: string) => {
  const d = await db()
  const tx = d.transaction(['books', 'files', 'lookups'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('files').delete(id)
  const lookups = tx.objectStore('lookups')
  for (const key of await lookups.index('byBook').getAllKeys(id)) await lookups.delete(key)
  await tx.done
}

export const listLookups = async (bookId?: string) => {
  const d = await db()
  const items = bookId
    ? await d.getAllFromIndex('lookups', 'byBook', bookId)
    : await d.getAll('lookups')
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export const putLookup = async (lookup: Lookup) => (await db()).put('lookups', lookup)
export const deleteLookup = async (id: string) => (await db()).delete('lookups', id)

export const getCached = async (key: string) => (await (await db()).get('cache', key))?.result
export const putCached = async (key: string, result: TranslationResult) =>
  (await db()).put('cache', { key, result, at: Date.now() })

export const takeInbox = async () => {
  const d = await db()
  const tx = d.transaction('inbox', 'readwrite')
  const items = await tx.store.getAll()
  await tx.store.clear()
  await tx.done
  return items.map(x => x.file)
}
