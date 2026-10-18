import { useEffect, useState } from 'preact/hooks'
import { getSettings, localEdits, PROVIDER_DEFAULTS, setSettings, type ProviderId, type Settings } from './settings'

// "Accounts" without a server: the user signs in with Google (Google Identity
// Services, token model) and the app keeps their settings, API keys included,
// in the Drive appDataFolder — a hidden, per-app folder in their own Drive
// that no other app (and no server of ours) can read.

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata'
const FILE = 'settings.json'
const STATE_KEY = 'only-reader:account'

export const accountsEnabled = !!CLIENT_ID

export type Profile = { email: string; name: string; picture?: string }

export type AccountState = {
  profile?: Profile
  lastSync?: number
  /** Local edits not yet uploaded. */
  dirty?: boolean
  busy?: boolean
  error?: string
}

type Token = { value: string; expiresAt: number }

type TokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string }
type TokenClient = { requestAccessToken: (o?: { prompt?: string; login_hint?: string }) => void }
type Gis = {
  accounts: {
    oauth2: {
      initTokenClient: (cfg: {
        client_id: string
        scope: string
        callback: (r: TokenResponse) => void
        error_callback?: (e: { type: string; message?: string }) => void
      }) => TokenClient
      revoke: (token: string, done?: () => void) => void
    }
  }
}

let token: Token | null = null
let state: AccountState = (() => {
  try {
    const { profile, lastSync, dirty } = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}')
    return { profile, lastSync, dirty }
  } catch {
    return {}
  }
})()
const listeners = new Set<(s: AccountState) => void>()

const setState = (patch: Partial<AccountState>) => {
  state = { ...state, ...patch }
  const { profile, lastSync, dirty } = state
  try { localStorage.setItem(STATE_KEY, JSON.stringify({ profile, lastSync, dirty })) } catch { /* blocked */ }
  for (const l of listeners) l(state)
}

export const useAccount = () => {
  const [s, set] = useState(state)
  useEffect(() => {
    listeners.add(set)
    set(state)
    return () => { listeners.delete(set) }
  }, [])
  return s
}

// --- Google Identity Services ---

let gisPromise: Promise<Gis> | undefined
const loadGis = () => gisPromise ??= new Promise<Gis>((resolve, reject) => {
  const script = document.createElement('script')
  script.src = 'https://accounts.google.com/gsi/client'
  script.async = true
  script.onload = () => resolve((window as unknown as { google: Gis }).google)
  script.onerror = () => {
    gisPromise = undefined
    reject(new Error(navigator.onLine ? 'Could not load Google sign-in.' : 'You are offline.'))
  }
  document.head.append(script)
})

/** Opens Google's popup; must run from a user gesture (tap). */
const requestToken = async (prompt: '' | 'select_account' = '') => {
  if (!CLIENT_ID) throw new Error('Google sign-in is not configured for this site.')
  const gis = await loadGis()
  return new Promise<Token>((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: r => {
        if (!r.access_token) return reject(new Error(r.error_description ?? r.error ?? 'Sign-in failed.'))
        resolve(token = { value: r.access_token, expiresAt: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 })
      },
      error_callback: e => reject(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled.' : e.message ?? e.type)),
    })
    client.requestAccessToken({ prompt, login_hint: state.profile?.email })
  })
}

const validToken = () => (token && token.expiresAt > Date.now() ? token.value : null)

class AuthExpired extends Error {}

const google = async (url: string, init: RequestInit = {}) => {
  const t = validToken()
  if (!t) throw new AuthExpired()
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${t}` } })
  if (res.status === 401) {
    token = null
    throw new AuthExpired()
  }
  if (!res.ok) throw new Error(`Google returned ${res.status}`)
  return res
}

// --- Drive appDataFolder ---

const DRIVE = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

type Remote = { version: 1; settings: Settings }

const findFile = async () => {
  const q = encodeURIComponent(`name='${FILE}'`)
  const res = await google(`${DRIVE}?spaces=appDataFolder&q=${q}&fields=files(id)`)
  return ((await res.json()).files?.[0]?.id as string | undefined) ?? null
}

const download = async (id: string): Promise<Remote | null> => {
  try {
    return await (await google(`${DRIVE}/${id}?alt=media`)).json()
  } catch (e) {
    if (e instanceof AuthExpired) throw e
    return null // unreadable file: overwrite it
  }
}

const upload = async (id: string | null, data: Remote) => {
  const body = JSON.stringify(data)
  if (id) {
    await google(`${UPLOAD}/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    })
    return
  }
  const boundary = `only-reader-${Math.random().toString(36).slice(2)}`
  const multipart = [
    `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
    JSON.stringify({ name: FILE, parents: ['appDataFolder'] }),
    `--${boundary}`, 'Content-Type: application/json', '', body, `--${boundary}--`,
  ].join('\r\n')
  await google(`${UPLOAD}?uploadType=multipart&fields=id`, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  })
}

/**
 * Newer settings win, except that an API key is never replaced by an empty
 * one: keys added on different devices for different providers all survive.
 */
const merge = (local: Settings, remote: Settings): Settings => {
  const [newer, older] = remote.updatedAt > local.updatedAt ? [remote, local] : [local, remote]
  const providers = { ...newer.providers }
  for (const id of Object.keys(PROVIDER_DEFAULTS) as ProviderId[]) {
    const n = newer.providers?.[id] ?? PROVIDER_DEFAULTS[id]
    const o = older.providers?.[id]
    providers[id] = { ...PROVIDER_DEFAULTS[id], ...n, apiKey: n.apiKey || o?.apiKey || '' }
  }
  return { ...older, ...newer, providers, updatedAt: Math.max(local.updatedAt, remote.updatedAt) }
}

const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b)

const syncOnce = async () => {
  const id = await findFile()
  const remote = id ? await download(id) : null
  const local = getSettings()
  const merged = remote?.settings ? merge(local, remote.settings) : local
  if (!same(merged, local)) setSettings(merged, { fromSync: true })
  if (!remote?.settings || !same(merged, remote.settings)) await upload(id, { version: 1, settings: merged })
  setState({ lastSync: Date.now(), dirty: false, error: undefined })
}

/** Sync now; `interactive` allows a Google popup if the session expired. */
export const sync = async (interactive = false) => {
  if (!state.profile || state.busy) return
  setState({ busy: true, error: undefined })
  try {
    try {
      await syncOnce()
    } catch (e) {
      if (!(e instanceof AuthExpired) || !interactive) throw e
      await requestToken()
      await syncOnce()
    }
  } catch (e) {
    // An expired session without a tap to reopen it is not an error, just pending.
    if (!(e instanceof AuthExpired)) setState({ error: (e as Error).message })
  } finally {
    setState({ busy: false })
  }
}

export const signIn = async () => {
  setState({ busy: true, error: undefined })
  try {
    await requestToken('select_account')
    const info = await (await google('https://www.googleapis.com/oauth2/v3/userinfo')).json()
    setState({ profile: { email: info.email, name: info.name ?? info.email, picture: info.picture }, busy: false })
    await sync()
  } catch (e) {
    setState({ busy: false, error: e instanceof AuthExpired ? 'Sign-in failed.' : (e as Error).message })
  }
}

/** Signs out and removes the API keys from this device (they stay in the account). */
export const signOut = () => {
  const t = validToken()
  if (t) loadGis().then(g => g.accounts.oauth2.revoke(t)).catch(() => {})
  token = null
  const s = getSettings()
  const providers = Object.fromEntries(Object.entries(s.providers)
    .map(([id, c]) => [id, { ...c, apiKey: '' }])) as Settings['providers']
  setSettings({ providers, updatedAt: s.updatedAt }, { fromSync: true })
  setState({ profile: undefined, lastSync: undefined, dirty: false, error: undefined })
}

// Push local edits shortly after they happen, while the Google session is open.
let pushTimer: ReturnType<typeof setTimeout> | undefined
localEdits.add(() => {
  if (!state.profile) return
  setState({ dirty: true })
  clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { if (validToken()) sync() }, 1500)
})
