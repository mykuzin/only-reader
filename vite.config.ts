import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'

// Books are untrusted content rendered in same-origin blob: iframes, so
// scripts inside them must be blocked by CSP (see public/foliate/README.md).
// Only applied to production builds: Vite's dev server injects inline scripts.
const csp = [
  "default-src 'self'",
  // accounts.google.com: Google sign-in (Identity Services script and popup).
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com",
  "style-src 'self' 'unsafe-inline' blob: https://accounts.google.com",
  "img-src 'self' blob: data: https://*.googleusercontent.com",
  "font-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "frame-src 'self' blob: https://accounts.google.com",
  "worker-src 'self' blob:",
  // LLM endpoints are user-configurable (incl. local servers), so allow any.
  "connect-src 'self' blob: data: https: http:",
  "object-src 'none'",
].join('; ')

const injectCsp = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: html =>
    html.replace('<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
})

export default defineConfig({
  // GitHub Pages serves the app from /only-reader/ (set by scripts/deploy.mjs).
  base: process.env.BASE_PATH || '/',
  plugins: [
    preact(),
    injectCsp(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,woff2,bcmap,pfb,ttf,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false, type: 'module' },
      manifest: {
        name: 'Only Reader',
        short_name: 'Reader',
        description: 'A quiet e-book reader with instant AI translation.',
        theme_color: '#f7f5f0',
        background_color: '#f7f5f0',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Android: "Share → Only Reader" from a file manager, Telegram, etc.
        share_target: {
          action: 'share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{
              name: 'books',
              accept: [
                'application/epub+zip', '.epub', 'application/pdf', '.pdf',
                'application/x-fictionbook+xml', '.fb2', '.fbz', '.mobi', '.azw', '.azw3',
                'application/vnd.comicbook+zip', '.cbz', 'text/plain', '.txt',
                'image/vnd.djvu', 'image/x-djvu', '.djvu', '.djv',
                'application/zip', 'application/octet-stream',
              ],
            }],
          },
        },
        // Desktop Chrome/Edge: "Open with → Only Reader".
        file_handlers: [{
          action: '.',
          accept: {
            'application/epub+zip': ['.epub'],
            'application/pdf': ['.pdf'],
            'image/vnd.djvu': ['.djvu', '.djv'],
            'application/x-fictionbook+xml': ['.fb2', '.fbz'],
            'application/x-mobipocket-ebook': ['.mobi', '.azw', '.azw3'],
            'application/vnd.comicbook+zip': ['.cbz'],
            'text/plain': ['.txt'],
          },
        }],
      } as any,
    }),
  ],
  build: { target: 'es2022' },
  worker: { format: 'es' },
  // djvu-rs locates its .wasm via import.meta.url, which pre-bundling breaks.
  optimizeDeps: { exclude: ['djvu-rs'] },
})
