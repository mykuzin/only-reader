import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { getBook, getBookFile, listLookups, updateBook, type BookRecord, type Lookup } from '../lib/db'
import { loadOverlayer, loadView, type FoliateView, type RelocateDetail, type TocItem } from '../lib/foliate'
import { parseBook } from '../lib/books'
import { resolveTheme, setSettings, useSettings, type Settings } from '../lib/settings'
import { goBack } from '../router'
import { Icon } from '../ui/icons'
import { Sheet } from '../ui/Sheet'
import { bookCSS, MARGINS, PALETTES } from './bookStyles'
import { contextOf, normalizeSelection } from './selection'
import { TranslationSheet, type TranslationTarget } from './TranslationSheet'
import { SearchPanel } from './SearchPanel'
import { TypographyPanel } from './TypographyPanel'

type Selection = { text: string; range: Range; index: number; doc: Document }
type Panel = null | 'toc' | 'search' | 'type'

const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined
  return (...a: A) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...a), ms)
  }
}

const applyLayout = (view: FoliateView, s: Settings) => {
  const theme = resolveTheme(s.theme)
  const palette = PALETTES[theme]
  const r = view.renderer
  view.classList.toggle('dark-fxl', view.isFixedLayout && (theme === 'dark' || theme === 'black'))
  view.classList.toggle('sepia-fxl', view.isFixedLayout && theme === 'sepia')
  if (view.isFixedLayout) {
    r.setAttribute('zoom', s.fxlZoom)
    return
  }
  r.setAttribute('flow', s.flow)
  r.setAttribute('gap', MARGINS[s.margin])
  r.setAttribute('margin', '44px')
  r.setAttribute('max-inline-size', '680px')
  r.setAttribute('max-column-count', '2')
  r.setAttribute('animated', '')
  r.setStyles?.(bookCSS(s, palette))
}

export const Reader = ({ id }: { id: string }) => {
  const settings = useSettings()
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const [book, setBook] = useState<BookRecord | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [chrome, setChrome] = useState(false)
  const [loc, setLoc] = useState<RelocateDetail | null>(null)
  const [toc, setToc] = useState<TocItem[]>([])
  const [panel, setPanel] = useState<Panel>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [trTarget, setTrTarget] = useState<TranslationTarget | null>(null)
  const [fractions, setFractions] = useState<number[]>([])
  const lookups = useRef(new Map<string, Lookup>())
  const annotationTapAt = useRef(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Overlays (sheets, panels) swallow taps; the book only reacts when nothing is open.
  const blocking = useRef(false)
  blocking.current = !!panel || !!trTarget

  const chromeRef = useRef(chrome)
  chromeRef.current = chrome

  // Left/right thirds turn pages; the middle shows the toolbars.
  const onTap = useCallback((fx: number) => {
    const view = viewRef.current
    if (!view || blocking.current) return
    if (chromeRef.current) setChrome(false)
    else if (fx < 0.3) view.goLeft()
    else if (fx > 0.7) view.goRight()
    else setChrome(true)
  }, [])

  // Open the book.
  useEffect(() => {
    let cancelled = false
    let view: FoliateView | null = null
    let parsed: { destroy?: () => void } | null = null
    const hostEl = host.current!

    const save = debounce((d: RelocateDetail) =>
      updateBook(id, { location: d.cfi, progress: d.fraction }), 600)

    ;(async () => {
      const [record, file] = await Promise.all([getBook(id), getBookFile(id)])
      if (!record || !file) throw new Error('Book not found')
      if (cancelled) return
      setBook(record)
      updateBook(id, { openedAt: Date.now() })

      const [, { Overlayer }] = await Promise.all([loadView(), loadOverlayer()])
      const book = await parseBook(file)
      parsed = book
      if (cancelled || !hostEl.isConnected) return book.destroy?.()

      view = document.createElement('foliate-view') as FoliateView
      viewRef.current = view
      hostEl.append(view)
      await view.open(book)
      applyLayout(view, settingsRef.current)

      for (const l of await listLookups(id)) if (l.cfi) lookups.current.set(l.cfi, l)

      view.addEventListener('relocate', (e: Event) => {
        const detail = (e as CustomEvent<RelocateDetail>).detail
        setLoc(detail)
        save(detail)
      })

      view.addEventListener('load', (e: Event) => {
        const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail
        wireDocument(doc, index)
      })

      view.addEventListener('create-overlay', (e: Event) => {
        const { index } = (e as CustomEvent<{ index: number }>).detail
        if (!settingsRef.current.underlineLookups) return
        for (const l of lookups.current.values())
          if (l.sectionIndex === index && l.cfi) view!.addAnnotation({ value: l.cfi })
      })
      view.addEventListener('draw-annotation', (e: Event) => {
        const { draw } = (e as CustomEvent<{ draw: (f: unknown, o: unknown) => void }>).detail
        const palette = PALETTES[resolveTheme(settingsRef.current.theme)]
        draw(Overlayer.underline, { color: palette.mark, width: 1.5 })
      })
      view.addEventListener('show-annotation', (e: Event) => {
        const { value } = (e as CustomEvent<{ value: string }>).detail
        const lookup = lookups.current.get(value)
        if (!lookup) return
        annotationTapAt.current = performance.now()
        setTrTarget({ kind: 'saved', lookup })
      })

      await view.init({ lastLocation: record.location, showTextStart: !record.location })
      if (cancelled) return
      setToc(view.book.toc ?? [])
      setFractions(view.getSectionFractions())
      setStatus('ready')
    })().catch(e => {
      console.error(e)
      if (!cancelled) setStatus('error')
    })

    const wireDocument = (doc: Document, index: number) => {
      const onSelection = debounce(() => {
        const sel = doc.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          setSelection(s => (s?.doc === doc ? null : s))
          return
        }
        const text = normalizeSelection(sel.toString())
        if (!text) return
        setSelection({ text: text.slice(0, 3000), range: sel.getRangeAt(0).cloneRange(), index, doc })
        setChrome(false)
      }, 150)
      doc.addEventListener('selectionchange', onSelection)

      doc.addEventListener('click', (e: MouseEvent) => {
        if (e.defaultPrevented || (e.target as Element)?.closest?.('a[href]')) return
        const sel = doc.getSelection()
        if (sel && !sel.isCollapsed) return
        const frame = doc.defaultView?.frameElement as HTMLElement | null
        let x = e.screenX
        if (frame) {
          const r = frame.getBoundingClientRect()
          x = r.left + e.clientX * (r.width / (frame.offsetWidth || r.width))
        }
        // Let foliate's annotation hit-test run first: tapping an underlined
        // word opens its translation instead of turning the page.
        setTimeout(() => {
          if (performance.now() - annotationTapAt.current < 400) return
          onTap(x / innerWidth)
        })
      })

      doc.addEventListener('keydown', onKey)
    }

    const onKey = (e: KeyboardEvent) => {
      const v = viewRef.current
      if (!v || blocking.current || (e.target as HTMLElement)?.closest?.('input, textarea')) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') v.goLeft()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') v.goRight()
    }
    addEventListener('keydown', onKey)

    return () => {
      cancelled = true
      removeEventListener('keydown', onKey)
      viewRef.current = null
      lookups.current.clear()
      try { view?.close() } catch { /* already torn down */ }
      view?.remove()
      parsed?.destroy?.()
    }
  }, [id])

  // Live typography/theme changes.
  useEffect(() => {
    const view = viewRef.current
    if (view && status === 'ready') applyLayout(view, settings)
  }, [status, settings.theme, settings.font, settings.fontSize, settings.lineHeight, settings.margin,
    settings.justify, settings.hyphenate, settings.flow, settings.fxlZoom])

  useEffect(() => {
    const view = viewRef.current
    if (!view || status !== 'ready') return
    for (const cfi of lookups.current.keys())
      settings.underlineLookups ? view.addAnnotation({ value: cfi }) : view.deleteAnnotation({ value: cfi })
  }, [status, settings.underlineLookups])

  const translateSelection = () => {
    const view = viewRef.current
    if (!selection || !view || !book) return
    const { text, range, index, doc } = selection
    let cfi: string | undefined
    try { cfi = view.getCFI(index, range) } catch { /* fixed layout without CFI support */ }
    setTrTarget({
      kind: 'new',
      bookId: book.id,
      cfi,
      sectionIndex: index,
      request: {
        text,
        context: contextOf(range, book.language),
        targetLang: settings.targetLang,
        bookTitle: book.title,
        bookAuthor: book.author,
        bookLanguage: book.language,
      },
    })
    doc.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const copySelection = async () => {
    if (!selection) return
    try { await navigator.clipboard.writeText(selection.text) } catch { /* blocked */ }
    selection.doc.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const onSaved = (l: Lookup) => {
    if (!l.cfi) return
    lookups.current.set(l.cfi, l)
    if (settings.underlineLookups) viewRef.current?.addAnnotation({ value: l.cfi })
  }
  const onRemoved = (l: Lookup) => {
    if (!l.cfi) return
    lookups.current.delete(l.cfi)
    viewRef.current?.deleteAnnotation({ value: l.cfi })
  }

  const goTo = (target: string) => {
    viewRef.current?.goTo(target)
    setPanel(null)
    setChrome(false)
  }

  const fraction = loc?.fraction ?? book?.progress ?? 0
  const percent = Math.round(fraction * 100)
  const minutesLeft = (loc as { time?: { section?: number } } | null)?.time?.section
  const chapter = loc?.tocItem?.label?.trim()
  const fixed = viewRef.current?.isFixedLayout ?? false

  return (
    <div class={`reader ${chrome ? 'chrome' : ''}`}>
      <div class="book-host" ref={host} />

      {status === 'loading' && <div class="reader-status"><span class="spinner" /></div>}
      {status === 'error' && (
        <div class="reader-status">
          <p>This book could not be opened.</p>
          <button class="btn" onClick={goBack}>Back to library</button>
        </div>
      )}

      {status === 'ready' && !chrome && (
        <div class="reader-foot" aria-hidden="true">
          <span>{chapter}</span>
          <span>{percent}%</span>
        </div>
      )}

      <header class="reader-bar top">
        <button class="icon-btn" onClick={goBack} aria-label="Back to library"><Icon name="back" /></button>
        <div class="reader-title">
          <span class="t">{book?.title}</span>
          {book?.author && <span class="a">{book.author}</span>}
        </div>
        <button class="icon-btn" onClick={() => setPanel('toc')} aria-label="Contents" disabled={!toc.length}>
          <Icon name="list" />
        </button>
        <button class="icon-btn" onClick={() => setPanel('search')} aria-label="Search"><Icon name="search" /></button>
        <button class="icon-btn" onClick={() => setPanel('type')} aria-label="Appearance"><Icon name="type" /></button>
      </header>

      <footer class="reader-bar bottom">
        <div class="progress-row">
          <span class="chapter">{chapter || book?.title}</span>
          <span class="muted">
            {minutesLeft != null && minutesLeft > 0.5 ? `${Math.round(minutesLeft)} min left in chapter · ` : ''}{percent}%
          </span>
        </div>
        <input type="range" class="slider" min={0} max={1} step={0.0005} value={fraction}
          aria-label="Reading progress" list="section-ticks"
          onChange={e => viewRef.current?.goToFraction(parseFloat((e.target as HTMLInputElement).value))} />
        <datalist id="section-ticks">
          {fractions.length < 80 && fractions.map(f => <option value={f} key={f} />)}
        </datalist>
      </footer>

      {selection && !trTarget && (
        <div class="selection-bar" role="toolbar" aria-label="Selection">
          <button class="sel-primary" onClick={translateSelection}>
            <Icon name="translate" size={18} /> Translate
          </button>
          <button class="sel-secondary" onClick={copySelection} aria-label="Copy"><Icon name="copy" size={18} /></button>
        </div>
      )}

      <Sheet open={panel === 'toc'} onClose={() => setPanel(null)} side="left" label="Contents">
        <h2 class="panel-title">Contents</h2>
        <nav class="toc">
          <TocList items={toc} current={loc?.tocItem?.href} onPick={goTo} depth={0} />
        </nav>
      </Sheet>

      <Sheet open={panel === 'search'} onClose={() => { setPanel(null); viewRef.current?.clearSearch() }} label="Search">
        {panel === 'search' && viewRef.current && <SearchPanel view={viewRef.current} onPick={goTo} />}
      </Sheet>

      <Sheet open={panel === 'type'} onClose={() => setPanel(null)} label="Appearance">
        <TypographyPanel settings={settings} fixedLayout={fixed} onChange={setSettings} />
      </Sheet>

      <TranslationSheet target={trTarget} onClose={() => setTrTarget(null)} onSaved={onSaved} onRemoved={onRemoved} />
    </div>
  )
}

const TocList = ({ items, current, onPick, depth }:
  { items: TocItem[]; current?: string; onPick: (href: string) => void; depth: number }) => (
  <ul>
    {items.map((item, i) => (
      <li key={`${item.href}-${i}`}>
        <button class={`toc-item ${item.href === current ? 'current' : ''}`}
          style={{ paddingLeft: `${16 + depth * 16}px` }} onClick={() => onPick(item.href)}>
          {item.label?.trim() || 'Untitled'}
        </button>
        {!!item.subitems?.length &&
          <TocList items={item.subitems} current={current} onPick={onPick} depth={depth + 1} />}
      </li>
    ))}
  </ul>
)
