import literataLatin from '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url'
import literataLatinExt from '@fontsource-variable/literata/files/literata-latin-ext-wght-normal.woff2?url'
import literataCyrillic from '@fontsource-variable/literata/files/literata-cyrillic-wght-normal.woff2?url'
import literataCyrillicExt from '@fontsource-variable/literata/files/literata-cyrillic-ext-wght-normal.woff2?url'
import literataLatinItalic from '@fontsource-variable/literata/files/literata-latin-wght-italic.woff2?url'
import literataCyrillicItalic from '@fontsource-variable/literata/files/literata-cyrillic-wght-italic.woff2?url'
import type { Settings } from '../lib/settings'

export const PALETTES = {
  light: { bg: '#fbfaf7', fg: '#1f1e1c', link: '#2f5d8a', selection: 'rgba(66, 120, 190, .28)', mark: '#c2873a' },
  sepia: { bg: '#f4ecd8', fg: '#4a3b2a', link: '#7a4b1c', selection: 'rgba(160, 110, 40, .28)', mark: '#a8692a' },
  dark: { bg: '#1c1c1e', fg: '#d9d6cf', link: '#8db4dd', selection: 'rgba(120, 160, 220, .35)', mark: '#d9a35b' },
  black: { bg: '#000000', fg: '#b8b5ae', link: '#7fa6cf', selection: 'rgba(120, 160, 220, .35)', mark: '#c99550' },
} as const

export type Palette = (typeof PALETTES)[keyof typeof PALETTES]

const abs = (u: string) => new URL(u, location.href).href

const fontFaces = () => {
  const face = (src: string, range: string, style = 'normal') => `@font-face {
    font-family: "Literata Reader"; font-style: ${style}; font-display: swap; font-weight: 200 900;
    src: url("${abs(src)}") format("woff2"); unicode-range: ${range};
  }`
  const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
  const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'
  const CYRILLIC = 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116'
  const CYRILLIC_EXT = 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F'
  return [
    face(literataLatin, LATIN),
    face(literataLatinExt, LATIN_EXT),
    face(literataCyrillic, CYRILLIC),
    face(literataCyrillicExt, CYRILLIC_EXT),
    face(literataLatinItalic, LATIN, 'italic'),
    face(literataCyrillicItalic, CYRILLIC, 'italic'),
  ].join('\n')
}

const FONT_STACKS: Record<Exclude<Settings['font'], 'publisher'>, string> = {
  literata: '"Literata Reader", Georgia, serif',
  serif: 'Georgia, "Noto Serif", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif',
}

/** CSS injected into every reflowable book section. */
export const bookCSS = (s: Settings, p: Palette) => {
  const family = s.font === 'publisher' ? null : FONT_STACKS[s.font]
  return `
@namespace epub "http://www.idpf.org/2007/ops";
${s.font === 'literata' ? fontFaces() : ''}
html {
  color-scheme: ${p.bg === PALETTES.light.bg || p.bg === PALETTES.sepia.bg ? 'light' : 'dark'};
  font-size: ${s.fontSize}% !important;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
}
html, body {
  background: ${p.bg} !important;
  color: ${p.fg} !important;
}
body * {
  color: inherit !important;
  background-color: transparent !important;
  border-color: color-mix(in srgb, currentColor 25%, transparent) !important;
}
${family ? `body, p, div, span, li, blockquote, dd, dt, td, th, h1, h2, h3, h4, h5, h6, em, i, b, strong, small, cite, a {
  font-family: ${family} !important;
}` : ''}
p, li, blockquote, dd, div {
  line-height: ${s.lineHeight} !important;
}
p, li, blockquote, dd {
  text-align: ${s.justify ? 'justify' : 'start'};
  -webkit-hyphens: ${s.hyphenate ? 'auto' : 'manual'};
  hyphens: ${s.hyphenate ? 'auto' : 'manual'};
  -webkit-hyphenate-limit-before: 3;
  -webkit-hyphenate-limit-after: 2;
  -webkit-hyphenate-limit-lines: 2;
  hanging-punctuation: allow-end last;
  widows: 2;
  orphans: 2;
}
[align="left"] { text-align: left; }
[align="right"] { text-align: right; }
[align="center"] { text-align: center; }
[align="justify"] { text-align: justify; }
a:any-link { color: ${p.link} !important; text-decoration-thickness: 1px; text-underline-offset: 2px; }
pre { white-space: pre-wrap !important; }
img, svg, video { max-width: 100%; height: auto; }
::selection { background: ${p.selection}; }
aside[epub|type~="endnote"],
aside[epub|type~="footnote"],
aside[epub|type~="note"],
aside[epub|type~="rearnote"] {
  display: none;
}
`
}

export const MARGINS: Record<Settings['margin'], string> = {
  narrow: '4%',
  normal: '7%',
  wide: '11%',
}
