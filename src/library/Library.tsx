import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { deleteBook, listBooks, takeInbox, type BookRecord } from '../lib/db'
import { ACCEPT, importFile, requestPersistentStorage } from '../lib/books'
import { navigate } from '../router'
import { Icon } from '../ui/icons'
import { Sheet } from '../ui/Sheet'

type Toast = { text: string; id: number }

/** Files handed over by the OS (share sheet, "Open with") before the UI mounted. */
const pending: File[] = []
let notifyPending: (() => void) | null = null
export const enqueueFiles = (files: File[]) => {
  pending.push(...files)
  notifyPending?.()
}

export const Library = () => {
  const [books, setBooks] = useState<BookRecord[] | null>(null)
  const [busy, setBusy] = useState(0)
  const [toast, setToast] = useState<Toast | null>(null)
  const [menu, setMenu] = useState<BookRecord | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const refresh = () => listBooks().then(setBooks)

  const say = (text: string) => {
    const id = Date.now()
    setToast({ text, id })
    setTimeout(() => setToast(t => (t?.id === id ? null : t)), 3200)
  }

  const importAll = async (files: File[]) => {
    if (!files.length) return
    requestPersistentStorage()
    setBusy(n => n + files.length)
    let last: BookRecord | undefined
    let added = 0
    const failed: string[] = []
    for (const f of files) {
      const r = await importFile(f)
      setBusy(n => n - 1)
      if (r.book) {
        last = r.book
        if (!r.existing) added++
      } else failed.push(`${r.name}: ${r.error}`)
    }
    await refresh()
    if (failed.length) say(failed.join('\n'))
    else if (files.length === 1 && last) navigate(`/read/${last.id}`)
    else if (added) say(`Added ${added} book${added > 1 ? 's' : ''}`)
  }

  useEffect(() => {
    refresh()
    const drain = () => importAll(pending.splice(0))
    notifyPending = drain
    // Shared files land in IndexedDB via the service worker.
    takeInbox().then(files => importAll([...pending.splice(0), ...files]))
    return () => { notifyPending = null }
  }, [])

  const onPick = (e: Event) => {
    const el = e.target as HTMLInputElement
    importAll(Array.from(el.files ?? []))
    el.value = ''
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    importAll(Array.from(e.dataTransfer?.files ?? []))
  }

  const remove = async (b: BookRecord) => {
    setMenu(null)
    await deleteBook(b.id)
    refresh()
    say(`Removed “${b.title}”`)
  }

  const [current, ...rest] = books ?? []
  const showHero = !!current?.openedAt && (current.progress ?? 0) < 0.995

  return (
    <div class={`library ${dragging ? 'dragging' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <header class="app-bar">
        <h1>Library</h1>
        <div class="actions">
          <button class="icon-btn" onClick={() => navigate('/words')} aria-label="Words"><Icon name="words" /></button>
          <button class="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings"><Icon name="settings" /></button>
        </div>
      </header>

      <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={onPick} />

      {books && !books.length && (
        <div class="empty">
          <img class="empty-logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={112} height={112} />
          <h2>A quiet place to read</h2>
          <p>Add EPUB, FB2, MOBI, AZW3, PDF, DjVu, CBZ or TXT books. They stay on this device.</p>
          <button class="btn primary" onClick={() => input.current?.click()}>
            <Icon name="plus" size={18} /> Add books
          </button>
          <p class="hint">Tip: select any word while reading to translate it.</p>
        </div>
      )}

      {books && !!books.length && (
        <main class="shelf">
          {showHero && (
            <button class="hero" onClick={() => navigate(`/read/${current.id}`)}>
              <Cover book={current} />
              <div class="hero-text">
                <span class="eyebrow">Continue reading</span>
                <span class="title">{current.title}</span>
                {current.author && <span class="author">{current.author}</span>}
                <span class="hero-progress">
                  <span class="bar"><span style={{ width: `${Math.round((current.progress ?? 0) * 100)}%` }} /></span>
                  {Math.round((current.progress ?? 0) * 100)}%
                </span>
              </div>
            </button>
          )}
          <div class="grid">
            {(showHero ? rest : books).map(b => (
              <BookCard key={b.id} book={b} onMenu={() => setMenu(b)} />
            ))}
          </div>
        </main>
      )}

      {books && !!books.length && (
        <button class="fab" onClick={() => input.current?.click()} aria-label="Add books">
          <Icon name="plus" />
        </button>
      )}

      {busy > 0 && <div class="toast"><span class="spinner small" /> Adding {busy} book{busy > 1 ? 's' : ''}…</div>}
      {!busy && toast && <div class="toast" role="status">{toast.text}</div>}

      <Sheet open={!!menu} onClose={() => setMenu(null)} label="Book options">
        {menu && (
          <div class="book-menu">
            <p class="title">{menu.title}</p>
            <p class="muted small">
              {[menu.author, menu.format, formatSize(menu.size)].filter(Boolean).join(' · ')}
            </p>
            <button class="menu-item" onClick={() => { setMenu(null); navigate(`/read/${menu.id}`) }}>
              <Icon name="book" size={20} /> Open
            </button>
            <button class="menu-item danger" onClick={() => remove(menu)}>
              <Icon name="trash" size={20} /> Remove from library
            </button>
          </div>
        )}
      </Sheet>
    </div>
  )
}

const formatSize = (n: number) =>
  n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

const BookCard = ({ book, onMenu }: { book: BookRecord; onMenu: () => void }) => {
  const press = useRef<ReturnType<typeof setTimeout>>(undefined)
  const longPressed = useRef(false)
  const progress = Math.round((book.progress ?? 0) * 100)
  return (
    <div class="card">
      <button class="card-cover"
        onClick={() => { if (!longPressed.current) navigate(`/read/${book.id}`) }}
        onContextMenu={e => { e.preventDefault(); onMenu() }}
        onTouchStart={() => {
          longPressed.current = false
          press.current = setTimeout(() => { longPressed.current = true; onMenu() }, 550)
        }}
        onTouchEnd={() => clearTimeout(press.current)}
        onTouchMove={() => clearTimeout(press.current)}>
        <Cover book={book} />
        {progress > 0 && <span class="card-progress"><span style={{ width: `${progress}%` }} /></span>}
      </button>
      <div class="card-meta">
        <div class="card-text">
          <span class="title">{book.title}</span>
          <span class="author">{book.author || book.format}</span>
        </div>
        <button class="icon-btn small" onClick={onMenu} aria-label={`Options for ${book.title}`}>
          <Icon name="more" size={18} />
        </button>
      </div>
    </div>
  )
}

const COVER_TINTS = ['#5b6c5d', '#7b5e57', '#56677a', '#836c4a', '#6b5b7a', '#4f6f6f', '#8a5a5a', '#5f6b4e']

export const Cover = ({ book }: { book: BookRecord }) => {
  const url = useMemo(() => (book.cover ? URL.createObjectURL(book.cover) : null), [book.cover])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  if (url) return <img class="cover" src={url} alt="" loading="lazy" decoding="async" />
  const tint = COVER_TINTS[[...book.id].reduce((a, c) => a + c.charCodeAt(0), 0) % COVER_TINTS.length]
  return (
    <div class="cover generated" style={{ background: tint }}>
      <span class="g-title">{book.title}</span>
      {book.author && <span class="g-author">{book.author}</span>}
      <span class="g-format">{book.format}</span>
    </div>
  )
}
