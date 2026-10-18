# Vendored foliate-js

Source: https://github.com/johnfactotum/foliate-js @ 78914aef4466eb960965702401634c2cb348e9b1 (2026-05-01), MIT.

Removed: demo reader (`reader.html`, `reader.js`, `ui/`), tests, build tooling, pdf.js source maps.

PDF is not rendered through foliate's `pdf.js` adapter: the app uses its own (`src/lib/pdf.ts`) with the
vendored `vendor/pdfjs` build, to add page caching and prefetch.

Local patches (re-apply when updating):
- `fixed-layout.js`: skip `onZoom` when the iframe's document is gone (ResizeObserver firing after teardown threw in `pdf.js`).
- `paginator.js`: `render()` returns early when the view's document is gone (same teardown race).
