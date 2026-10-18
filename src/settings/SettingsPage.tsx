import { useEffect, useState } from 'preact/hooks'
import { PROVIDER_DEFAULTS, setProviderConfig, setSettings, useSettings, type ProviderId } from '../lib/settings'
import { listModels, PROVIDER_LABELS, translate, TranslateError } from '../lib/translate'
import { goBack } from '../router'
import { Icon } from '../ui/icons'
import { Segmented, Toggle } from '../reader/TypographyPanel'

const QUICK_LANGS = [
  { value: 'Ukrainian', label: 'Українська' },
  { value: 'Russian', label: 'Русский' },
  { value: 'English', label: 'English' },
]

const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openrouter', 'gemini', 'openai']

const KEY_HELP: Record<ProviderId, { url: string; hint: string }> = {
  anthropic: { url: 'https://platform.claude.com/settings/keys', hint: 'Starts with sk-ant-' },
  openrouter: { url: 'https://openrouter.ai/settings/keys', hint: 'Starts with sk-or- · one key for Claude, GPT, Gemini, DeepSeek and more' },
  openai: { url: 'https://platform.openai.com/api-keys', hint: 'OpenAI, DeepSeek, Groq, a local Ollama — any OpenAI-compatible API' },
  gemini: { url: 'https://aistudio.google.com/apikey', hint: 'Free tier available in Google AI Studio' },
}

export const SettingsPage = () => {
  const s = useSettings()
  const p = s.providers[s.provider]
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [modelsState, setModelsState] = useState<string>('')
  const [test, setTest] = useState<{ state: 'idle' | 'running' | 'ok' | 'error'; text?: string }>({ state: 'idle' })
  const [storage, setStorage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null)
  const custom = !QUICK_LANGS.some(l => l.value === s.targetLang)

  useEffect(() => {
    setModels([])
    setModelsState('')
    setTest({ state: 'idle' })
  }, [s.provider])

  useEffect(() => {
    (async () => {
      try {
        const est = await navigator.storage.estimate()
        setStorage({ used: est.usage ?? 0, quota: est.quota ?? 0, persisted: await navigator.storage.persisted() })
      } catch { /* unsupported */ }
    })()
  }, [])

  const loadModels = async () => {
    setModelsState('Loading…')
    try {
      const list = await listModels(s.provider, p)
      setModels(list)
      setModelsState(list.length ? `${list.length} models available` : 'No models returned')
    } catch (e) {
      setModelsState(e instanceof TranslateError ? e.message : 'Could not load models')
    }
  }

  const runTest = async () => {
    setTest({ state: 'running' })
    try {
      const r = await translate({
        text: 'serendipity',
        context: 'Meeting her in that tiny bookshop was pure serendipity.',
        targetLang: s.targetLang,
      }, { fresh: true })
      setTest({ state: 'ok', text: `serendipity → ${r.translation}` })
    } catch (e) {
      setTest({ state: 'error', text: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div class="page settings">
      <header class="app-bar">
        <button class="icon-btn" onClick={goBack} aria-label="Back"><Icon name="back" /></button>
        <h1>Settings</h1>
      </header>

      <main class="page-body">
        <section class="group">
          <h2>Translation</h2>
          <p class="group-hint">
            Select a word or passage while reading and tap Translate. Your key is stored on this device only;
            the selection and its sentence go straight to the provider you choose.
          </p>

          <div class="field stacked">
            <span class="field-label">Translate into</span>
            <div class="chips">
              {QUICK_LANGS.map(l => (
                <button key={l.value} class={`chip-btn ${s.targetLang === l.value ? 'on' : ''}`}
                  onClick={() => setSettings({ targetLang: l.value })}>{l.label}</button>
              ))}
              <button class={`chip-btn ${custom ? 'on' : ''}`}
                onClick={() => !custom && setSettings({ targetLang: '' })}>Other…</button>
            </div>
            {custom && (
              <input class="text-input" placeholder="e.g. Polish, German, Español" value={s.targetLang}
                onInput={e => setSettings({ targetLang: (e.target as HTMLInputElement).value })} />
            )}
          </div>

          <div class="field stacked">
            <span class="field-label">Provider</span>
            <div class="chips" role="radiogroup" aria-label="Provider">
              {PROVIDER_ORDER.map(id => (
                <button key={id} role="radio" aria-checked={s.provider === id}
                  class={`chip-btn ${s.provider === id ? 'on' : ''}`} onClick={() => setSettings({ provider: id })}>
                  {PROVIDER_LABELS[id]}
                  {!!s.providers[id].apiKey && <span class="key-dot" aria-label="key added" />}
                </button>
              ))}
            </div>
          </div>

          {s.provider === 'openai' && (
            <label class="field stacked">
              <span class="field-label">Base URL</span>
              <input class="text-input mono" inputMode="url" autoComplete="off" spellcheck={false}
                value={p.baseUrl} placeholder={PROVIDER_DEFAULTS.openai.baseUrl}
                onInput={e => setProviderConfig('openai', { baseUrl: (e.target as HTMLInputElement).value.trim() })} />
              <span class="field-hint">DeepSeek: https://api.deepseek.com/v1 · Groq: https://api.groq.com/openai/v1</span>
            </label>
          )}

          <label class="field stacked">
            <span class="field-label">API key</span>
            <div class="input-with-btn">
              <input class="text-input mono" type={(showKey ? 'text' : 'password') as 'text'} autoComplete="off"
                spellcheck={false} value={p.apiKey} placeholder="Paste your key"
                onInput={e => setProviderConfig(s.provider, { apiKey: (e.target as HTMLInputElement).value.trim() })} />
              <button class="icon-btn" onClick={e => { e.preventDefault(); setShowKey(v => !v) }}
                aria-label={showKey ? 'Hide key' : 'Show key'}>
                <Icon name={showKey ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </div>
            <span class="field-hint">
              {KEY_HELP[s.provider].hint} · <a href={KEY_HELP[s.provider].url} target="_blank" rel="noreferrer">Get a key</a>
            </span>
          </label>

          <label class="field stacked">
            <span class="field-label">Model</span>
            <div class="input-with-btn">
              <input class="text-input mono" list="model-list" autoComplete="off" spellcheck={false}
                value={p.model} placeholder={PROVIDER_DEFAULTS[s.provider].model}
                onInput={e => setProviderConfig(s.provider, { model: (e.target as HTMLInputElement).value.trim() })} />
              <button class="btn ghost small" onClick={e => { e.preventDefault(); loadModels() }}>List</button>
            </div>
            <datalist id="model-list">{models.map(m => <option key={m} value={m} />)}</datalist>
            <span class="field-hint">
              {modelsState || (s.provider === 'anthropic'
                ? 'claude-opus-5-5 gives the best nuance; claude-haiku-5-5 is much faster and cheaper.'
                : s.provider === 'openrouter'
                  ? 'Use provider/model IDs, e.g. google/gemini-2.5-flash. Tap List for all of them.'
                  : 'Tap List to see the models your key can use.')}
            </span>
          </label>

          <div class="test-row">
            <button class="btn" onClick={runTest} disabled={test.state === 'running' || !p.apiKey}>
              {test.state === 'running' ? <span class="spinner small" /> : <Icon name="translate" size={18} />}
              Test translation
            </button>
            {test.text && <span class={`test-result ${test.state}`}>{test.text}</span>}
          </div>
        </section>

        <section class="group">
          <h2>Appearance</h2>
          <div class="field stacked">
            <span class="field-label">Theme</span>
            <Segmented label="Theme" value={s.theme} onChange={v => setSettings({ theme: v })} options={[
              { value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }, { value: 'sepia', label: 'Sepia' },
              { value: 'dark', label: 'Dark' }, { value: 'black', label: 'Black' },
            ]} />
          </div>
          <Toggle checked={s.underlineLookups} onChange={v => setSettings({ underlineLookups: v })}>
            Underline translated words in books
          </Toggle>
        </section>

        <section class="group">
          <h2>Storage</h2>
          <p class="group-hint">
            Books are stored in this browser only.
            {storage && ` Using ${formatBytes(storage.used)} of ${formatBytes(storage.quota)}.`}
            {storage && (storage.persisted
              ? ' Storage is persistent, so the browser will not clear it on its own.'
              : ' Install the app to the home screen to keep books from being cleared.')}
          </p>
        </section>

        <p class="about">Only Reader · rendering by foliate-js · books never leave your device</p>
      </main>
    </div>
  )
}

const formatBytes = (n: number) =>
  n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`
