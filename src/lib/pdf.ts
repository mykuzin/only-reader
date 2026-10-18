import { foliateURL, type TocItem } from './foliate'
import { makeFixedBook, type PageSource } from './fixedLayout'

// pdf.js is the copy vendored with foliate-js (public/foliate/vendor/pdfjs).
/* eslint-disable @typescript-eslint/no-explicit-any */
type PdfJs = any

let pdfjsPromise: Promise<{ lib: PdfJs; css: string }> | undefined

const loadPdfjs = () => pdfjsPromise ??= (async () => {
  await import(/* @vite-ignore */ foliateURL('vendor/pdfjs/pdf.mjs'))
  const lib = (globalThis as any).pdfjsLib as PdfJs
  lib.GlobalWorkerOptions.workerSrc = foliateURL('vendor/pdfjs/pdf.worker.mjs')
  const css = (await Promise.all(['text_layer_builder.css', 'annotation_layer_builder.css']
    .map(async f => (await fetch(foliateURL(`vendor/pdfjs/${f}`))).text()))).join('\n')
  return { lib, css }
})()

export const isPDF = async (file: Blob) => {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  return String.fromCharCode(...head) === '%PDF-'
}

export const makePdfBook = async (file: File) => {
  const { lib, css } = await loadPdfjs()

  // Feed pdf.js byte ranges straight from the File, so big PDFs are never
  // read into memory as a whole.
  const transport = new lib.PDFDataRangeTransport(file.size, [])
  transport.requestDataRange = (begin: number, end: number) => {
    file.slice(begin, end).arrayBuffer().then(chunk => transport.onDataRange(begin, chunk))
  }
  const pdf = await lib.getDocument({
    range: transport,
    cMapUrl: foliateURL('vendor/pdfjs/cmaps/'),
    standardFontDataUrl: foliateURL('vendor/pdfjs/standard_fonts/'),
    isEvalSupported: false,
  }).promise

  const pages = new Map<number, Promise<any>>()
  const page = (i: number) => {
    let p = pages.get(i)
    if (!p) pages.set(i, p = pdf.getPage(i + 1))
    return p
  }

  const source: PageSource = {
    count: pdf.numPages,
    css,
    pageSize: async i => {
      const vp = (await page(i)).getViewport({ scale: 1 })
      return { width: vp.width, height: vp.height }
    },
    render: async (i, width, height, signal) => {
      const p = await page(i)
      signal?.throwIfAborted()
      const viewport = p.getViewport({ scale: width / p.getViewport({ scale: 1 }).width })
      // The canvas must live in the main document: that is where pdf.js loads fonts.
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const task = p.render({ canvasContext: canvas.getContext('2d'), viewport })
      const cancel = () => task.cancel()
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        await task.promise
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
      const bmp = await createImageBitmap(canvas)
      canvas.width = canvas.height = 0
      return bmp
    },
    text: async (i, doc, scale) => {
      const p = await page(i)
      const viewport = p.getViewport({ scale })
      const container = doc.querySelector<HTMLElement>('.textLayer')!
      await new lib.TextLayer({ textContentSource: await p.getTextContent(), container, viewport }).render()
      // pdf.js leaves measuring canvases in the main document.
      for (const c of document.querySelectorAll<HTMLElement>('.hiddenCanvasElement'))
        Object.assign(c.style, { position: 'absolute', width: '0', height: '0', display: 'none' })
      const end = doc.createElement('div')
      end.className = 'endOfContent'
      container.append(end)
      container.onpointerdown = () => container.classList.add('selecting')
      container.onpointerup = () => container.classList.remove('selecting')

      const div = doc.querySelector<HTMLElement>('.annotationLayer')!
      const linkService = {
        goToDestination: () => {},
        getDestinationHash: (dest: unknown) => JSON.stringify(dest),
        addLinkAttributes: (link: HTMLAnchorElement, url: string) => { link.href = url },
      }
      await new lib.AnnotationLayer({ page: p, viewport, div, linkService })
        .render({ annotations: await p.getAnnotations() })
    },
    plainText: async i => {
      const content = await (await page(i)).getTextContent()
      return content.items.map((x: { str?: string; hasEOL?: boolean }) =>
        (x.str ?? '') + (x.hasEOL ? '\n' : '')).join('')
    },
    destroy: () => { pdf.destroy() },
  }

  const destIndex = async (href: string) => {
    const parsed = JSON.parse(href)
    const dest = typeof parsed === 'string' ? await pdf.getDestination(parsed) : parsed
    return pdf.getPageIndex(dest[0]) as Promise<number>
  }
  const toTOC = (item: any): TocItem => ({
    label: item.title,
    href: JSON.stringify(item.dest),
    subitems: item.items?.length ? item.items.map(toTOC) : null,
  })

  const { metadata, info } = (await pdf.getMetadata().catch(() => null)) ?? {}
  const outline = await pdf.getOutline().catch(() => null)

  return makeFixedBook(source, {
    metadata: {
      title: metadata?.get('dc:title') ?? info?.Title,
      author: metadata?.get('dc:creator') ?? info?.Author,
      language: metadata?.get('dc:language'),
    },
    toc: outline?.map(toTOC),
    resolveHref: async href => ({ index: await destIndex(href) }),
    splitTOCHref: async href => [await destIndex(href), null],
  })
}
