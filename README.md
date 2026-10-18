# Only Reader

A quiet, installable e-book reader (PWA) with one-tap AI translation of any selected word or passage.

- **Formats:** EPUB, FB2/FBZ, MOBI, AZW3, PDF, DjVu, CBZ, TXT (UTF-8 or Windows-1251).
  PDF and DjVu pages are rendered ahead and cached, so page turns don't wait for drawing; their text layers
  make scanned words selectable for translation (DjVu files over 80 MB open in a lighter, view-only mode).
- **Reading:** paged or scrolled, tap zones, themes (light / sepia / dark / black), Literata font, size, spacing,
  margins, justification, hyphenation, contents, full-text search, progress saved per book
- **Translation:** select text → **Translate**. Words get a translation, transcription, part of speech, alternatives
  and a short note on what they mean *in this sentence*; passages get a natural translation. Translated words are
  underlined in the book (tap to see them again) and collected in **Words**, exportable as CSV for Anki.
- **Providers:** Claude, any OpenAI-compatible API (OpenAI, OpenRouter, DeepSeek, Groq, Ollama…), Gemini.
  Your API key is stored only on the device; requests go straight from the browser to the provider.
- **Offline:** the app is cached by a service worker; books live in IndexedDB on the device.
- **Android:** install to the home screen, then use **Share → Only Reader** from a file manager or Telegram to add books.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173 (and your LAN address)
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ locally
```

On a phone over plain `http://` (LAN) the app works, but the service worker (offline, install, share target)
needs HTTPS. Use a real deployment or `chrome://inspect` port forwarding to `localhost` for those.

## Deploy

`dist/` is a static site. Any HTTPS static host works: Cloudflare Pages, Netlify, GitHub Pages, Vercel.
Build command `npm run build`, output directory `dist`. For a sub-path (e.g. GitHub Pages project sites)
set Vite's `base` in `vite.config.ts`.

## Structure

```
public/foliate/          foliate-js rendering engine (vendored, see VENDOR.md)
src/lib/                 storage (IndexedDB), settings, book import, TXT adapter, translation providers
src/lib/fixedLayout.ts   page cache + prefetch shared by PDF (pdf.ts) and DjVu (djvu.ts, djvu.worker.ts)
src/reader/              reader screen, translation sheet, search, typography
src/library/, words/, settings/   other screens
src/sw.ts                service worker (precache + Android share target)
```

DjVu decoding uses [djvu-rs](https://github.com/matyushkin/djvu-rs) (MIT, WebAssembly) in a Web Worker.

Books are untrusted content: a Content-Security-Policy that blocks scripts inside books is injected into
production builds (`vite.config.ts`).
