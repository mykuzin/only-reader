import type { FoliateBook, TocItem } from './foliate'

// foliate-js has no plain-text reader, so this implements its "book"
// interface: sections split at chapter headings (or every ~40k characters).

const CHAPTER = /^\s*(chapter|part|book|глава|часть|частина|розділ|книга)\s+([\divxlcdm]+|[\p{L}-]+)\b.{0,80}$/iu
const MAX_SECTION_CHARS = 40_000

const decode = (buf: ArrayBuffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    // Old Russian/Ukrainian .txt files are usually Windows-1251.
    return new TextDecoder('windows-1251').decode(buf)
  }
}

const escape = (s: string) =>
  // eslint-disable-next-line no-control-regex -- characters that are invalid in XML
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const toParagraphs = (text: string) => {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^﻿/, '')
  const blankSeparated = (normalized.match(/\n\s*\n/g)?.length ?? 0) > normalized.split('\n').length / 8
  return (blankSeparated ? normalized.split(/\n\s*\n/) : normalized.split('\n'))
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
}

type Section = { title?: string; paragraphs: string[] }

const toSections = (paragraphs: string[]) => {
  const sections: Section[] = [{ paragraphs: [] }]
  let size = 0
  for (const p of paragraphs) {
    const isHeading = p.length < 100 && CHAPTER.test(p)
    const last = sections[sections.length - 1]
    if ((isHeading && last.paragraphs.length) || size > MAX_SECTION_CHARS) {
      sections.push({ title: isHeading ? p : undefined, paragraphs: isHeading ? [] : [p] })
      size = isHeading ? 0 : p.length
    } else if (isHeading) {
      last.title = p
    } else {
      last.paragraphs.push(p)
      size += p.length
    }
  }
  return sections
}

const toHTML = (s: Section, lang: string) => `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${lang}"><head><meta charset="utf-8"/>
<style>p { text-indent: 1.5em; margin: 0 0 .3em; } h2 { text-align: center; margin: 1em 0 1.5em; }</style>
</head><body>
${s.title ? `<h2>${escape(s.title)}</h2>` : ''}
${s.paragraphs.map(p => `<p>${escape(p)}</p>`).join('\n')}
</body></html>`

const guessLang = (text: string) => {
  const sample = text.slice(0, 5000)
  const cyr = sample.match(/\p{Script=Cyrillic}/gu)?.length ?? 0
  const lat = sample.match(/\p{Script=Latin}/gu)?.length ?? 0
  if (cyr > lat) return /[іїєґ]/i.test(sample) ? 'uk' : 'ru'
  return 'en'
}

export const isTxt = (file: File) =>
  file.type === 'text/plain' || /\.txt$/i.test(file.name)

export const makeTxtBook = async (file: File): Promise<FoliateBook> => {
  const text = decode(await file.arrayBuffer())
  const lang = guessLang(text)
  const sections = toSections(toParagraphs(text))
  const urls = new Map<number, string>()
  const parser = new DOMParser()

  const toc: TocItem[] = sections
    .map((s, i) => (s.title ? { label: s.title, href: String(i) } : null))
    .filter((x): x is TocItem => !!x)

  // Project Gutenberg and many library dumps start with "Title: …" / "Author: …".
  const head = text.slice(0, 4000)
  const title = head.match(/^\s*(?:Title|Название|Назва)\s*:\s*(.+)$/im)?.[1]?.trim()
  const author = head.match(/^\s*(?:Author|Автор)\s*:\s*(.+)$/im)?.[1]?.trim()

  return {
    metadata: { title: title || file.name.replace(/\.txt$/i, ''), author, language: lang },
    dir: 'ltr',
    toc,
    sections: sections.map((s, i) => {
      const html = toHTML(s, lang)
      return {
        id: i,
        size: html.length,
        linear: 'yes',
        load: () => {
          if (!urls.has(i))
            urls.set(i, URL.createObjectURL(new Blob([html], { type: 'application/xhtml+xml' })))
          return urls.get(i)
        },
        unload: () => {
          const url = urls.get(i)
          if (url) URL.revokeObjectURL(url)
          urls.delete(i)
        },
        createDocument: () => parser.parseFromString(html, 'application/xhtml+xml'),
      }
    }),
    // Navigation helpers used by foliate's view and progress modules.
    resolveHref: (href: string) => ({ index: Number(href), anchor: (doc: Document) => doc.body }),
    splitTOCHref: (href: string) => [Number(href), null],
    getTOCFragment: (doc: Document) => doc.body,
    isExternal: (href: string) => /^\w+:/i.test(href),
    destroy: () => { for (const url of urls.values()) URL.revokeObjectURL(url) },
  } as FoliateBook
}
