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
- **Providers:** Claude, OpenRouter (one key for hundreds of models), Gemini, or any OpenAI-compatible API
  (OpenAI, DeepSeek, Groq, Ollama…). Requests go straight from the browser to the provider.
- **Account (optional):** sign in with Google to keep settings and API keys on every device. They are stored in
  the Drive `appDataFolder` — a hidden folder in the user's own Drive that only this app can read. No server.
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

Live at **https://mykuzin.github.io/only-reader/**. To publish the current commit:

```sh
npm run deploy     # builds with base /only-reader/ and force-pushes dist/ to the gh-pages branch
```

`dist/` is a plain static site, so any HTTPS host works; set `BASE_PATH` when it is served from a sub-path.

## Google sign-in setup (one time)

Sign-in stays hidden until a Google OAuth client ID is configured:

1. Open https://console.cloud.google.com/ and create a project (e.g. "Only Reader").
2. **APIs & Services → Library →** enable **Google Drive API**.
3. **Google Auth Platform → Branding:** app name "Only Reader", your email as support and developer contact.
   **Audience:** External. While in *Testing*, add the Google accounts allowed to sign in as test users
   (or press *Publish app*; the `drive.appdata` scope needs no Google verification).
4. **Data Access → Add scopes:** `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`,
   `.../auth/drive.appdata`.
5. **Clients → Create client → Web application.** Authorized JavaScript origins:
   `https://mykuzin.github.io`, plus `http://localhost:5173` and `http://localhost:4173` for development.
   No redirect URIs are needed.
6. Put the client ID in `.env` (it is public, not a secret) and redeploy:

   ```sh
   echo VITE_GOOGLE_CLIENT_ID=1234567890-abc.apps.googleusercontent.com > .env
   npm run deploy
   ```

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
