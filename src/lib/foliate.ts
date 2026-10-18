// foliate-js ships as native ES modules with relative imports and
// import.meta.url-based asset paths (pdf.js worker, cmaps), so it is served
// untouched from /public/foliate and imported at runtime instead of bundled.

export type TocItem = { label: string; href: string; subitems?: TocItem[] | null }

export type FoliateBook = {
  metadata?: { title?: unknown; author?: unknown; language?: unknown }
  toc?: TocItem[]
  dir?: string
  rendition?: { layout?: string }
  sections: unknown[]
  getCover?: () => Promise<Blob | null> | Blob | null
  destroy?: () => void
}

export type RelocateDetail = {
  fraction: number
  cfi: string
  range?: Range
  tocItem?: { label?: string; href?: string }
  pageItem?: { label?: string }
  location?: { current: number; total: number }
  section?: { current: number; total: number }
}

export type FoliateView = HTMLElement & {
  book: FoliateBook
  renderer: HTMLElement & {
    setStyles?: (css: string) => void
    getContents: () => { index: number; doc: Document; overlayer?: unknown }[]
    next: () => Promise<void>
    prev: () => Promise<void>
  }
  isFixedLayout: boolean
  lastLocation?: RelocateDetail
  open: (book: File | Blob | FoliateBook) => Promise<void>
  close: () => void
  init: (opts: { lastLocation?: string; showTextStart?: boolean }) => Promise<void>
  goTo: (target: string | number) => Promise<unknown>
  goToFraction: (frac: number) => Promise<void>
  goLeft: () => Promise<void>
  goRight: () => Promise<void>
  prev: () => Promise<void>
  next: () => Promise<void>
  getCFI: (index: number, range: Range) => string
  getSectionFractions: () => number[]
  addAnnotation: (a: { value: string }) => Promise<unknown>
  deleteAnnotation: (a: { value: string }) => Promise<unknown>
  search: (opts: { query: string; matchCase?: boolean; matchWholeWords?: boolean }) =>
    AsyncGenerator<SearchResult | 'done'>
  clearSearch: () => void
  deselect: () => void
}

export type SearchExcerpt = { pre: string; match: string; post: string }
export type SearchResult =
  | { progress: number }
  | { label: string; subitems: { cfi: string; excerpt: SearchExcerpt }[] }
  | { cfi: string; excerpt: SearchExcerpt }

type Draw = (rects: DOMRectList, opts?: Record<string, unknown>) => SVGElement
type ViewModule = { makeBook: (file: File) => Promise<FoliateBook> }
type OverlayerModule = { Overlayer: { underline: Draw; highlight: Draw; squiggly: Draw; outline: Draw } }

const base = new URL(`${import.meta.env.BASE_URL}foliate/`, location.href)
export const foliateURL = (path: string) => new URL(path, base).href
const load = <T,>(path: string): Promise<T> => import(/* @vite-ignore */ foliateURL(path))

export const loadView = () => load<ViewModule>('view.js')
export const loadOverlayer = () => load<OverlayerModule>('overlayer.js')

/** Titles/names may be a string or a { lang: string } map. */
export const formatLanguageMap = (x: unknown): string => {
  if (!x) return ''
  if (typeof x === 'string') return x
  const values = Object.values(x as Record<string, string>)
  return values[0] ?? ''
}

export const formatContributors = (x: unknown): string => {
  const one = (c: unknown) =>
    typeof c === 'string' ? c : formatLanguageMap((c as { name?: unknown })?.name)
  return Array.isArray(x) ? x.map(one).filter(Boolean).join(', ') : one(x)
}
