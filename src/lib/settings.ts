import { useEffect, useState } from 'preact/hooks'

export type ProviderId = 'openai' | 'openrouter' | 'anthropic' | 'gemini'
export type Theme = 'auto' | 'light' | 'sepia' | 'dark' | 'black'
export type FontChoice = 'publisher' | 'literata' | 'serif' | 'sans'

export type ProviderConfig = { apiKey: string; model: string; baseUrl?: string }

export type Settings = {
  provider: ProviderId
  providers: Record<ProviderId, ProviderConfig>
  targetLang: string
  underlineLookups: boolean
  theme: Theme
  font: FontChoice
  fontSize: number // percent
  lineHeight: number
  margin: 'narrow' | 'normal' | 'wide'
  justify: boolean
  hyphenate: boolean
  flow: 'paginated' | 'scrolled'
  fxlZoom: 'fit-page' | 'fit-width'
  /** Last local edit, used to reconcile with the copy in the user's Google Drive. */
  updatedAt: number
}

export const PROVIDER_DEFAULTS: Record<ProviderId, ProviderConfig> = {
  openai: { apiKey: '', model: 'gpt-5-mini', baseUrl: 'https://api.openai.com/v1' },
  openrouter: { apiKey: '', model: 'google/gemini-2.5-flash' },
  anthropic: { apiKey: '', model: 'claude-opus-5-5' },
  gemini: { apiKey: '', model: 'gemini-2.5-flash' },
}

const DEFAULTS: Settings = {
  provider: 'anthropic',
  providers: PROVIDER_DEFAULTS,
  targetLang: 'Ukrainian',
  underlineLookups: true,
  theme: 'auto',
  font: 'literata',
  fontSize: 100,
  lineHeight: 1.5,
  margin: 'normal',
  justify: true,
  hyphenate: true,
  flow: 'paginated',
  fxlZoom: 'fit-page',
  updatedAt: 0,
}

const KEY = 'only-reader:settings'

const load = (): Settings => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return {
      ...DEFAULTS,
      ...saved,
      providers: {
        openai: { ...PROVIDER_DEFAULTS.openai, ...saved.providers?.openai },
        openrouter: { ...PROVIDER_DEFAULTS.openrouter, ...saved.providers?.openrouter },
        anthropic: { ...PROVIDER_DEFAULTS.anthropic, ...saved.providers?.anthropic },
        gemini: { ...PROVIDER_DEFAULTS.gemini, ...saved.providers?.gemini },
      },
    }
  } catch {
    return DEFAULTS
  }
}

let current = load()
const listeners = new Set<(s: Settings) => void>()

export const getSettings = () => current

/** Notified on edits made in this app (not on settings pulled from sync). */
export const localEdits = new Set<() => void>()

export const setSettings = (patch: Partial<Settings>, opts: { fromSync?: boolean } = {}) => {
  current = { ...current, ...patch, updatedAt: opts.fromSync ? patch.updatedAt ?? current.updatedAt : Date.now() }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* storage full or blocked */ }
  for (const l of listeners) l(current)
  if (!opts.fromSync) for (const l of localEdits) l()
}

export const setProviderConfig = (id: ProviderId, patch: Partial<ProviderConfig>) =>
  setSettings({ providers: { ...current.providers, [id]: { ...current.providers[id], ...patch } } })

export const useSettings = () => {
  const [s, set] = useState(current)
  useEffect(() => {
    listeners.add(set)
    set(current)
    return () => { listeners.delete(set) }
  }, [])
  return s
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)')

export const resolveTheme = (t: Theme): Exclude<Theme, 'auto'> =>
  t === 'auto' ? (darkQuery.matches ? 'dark' : 'light') : t

/** Keeps <html data-theme> and the browser chrome color in sync with settings. */
export const applyTheme = () => {
  const apply = () => {
    const theme = resolveTheme(current.theme)
    document.documentElement.dataset.theme = theme
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
  }
  apply()
  listeners.add(apply)
  darkQuery.addEventListener('change', apply)
}
