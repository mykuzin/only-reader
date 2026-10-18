import { useEffect, useRef, useState } from 'preact/hooks'
import { Sheet } from '../ui/Sheet'
import { Icon } from '../ui/icons'
import { deleteLookup, putLookup, type Lookup, type TranslationResult } from '../lib/db'
import { translate, TranslateError, PROVIDER_LABELS, type TranslateRequest } from '../lib/translate'
import { useSettings } from '../lib/settings'
import { navigate } from '../router'

export type TranslationTarget =
  | { kind: 'new'; request: TranslateRequest; bookId: string; cfi?: string; sectionIndex?: number }
  | { kind: 'saved'; lookup: Lookup }

type Props = {
  target: TranslationTarget | null
  onClose: () => void
  onSaved: (lookup: Lookup) => void
  onRemoved: (lookup: Lookup) => void
}

/** Short selections are vocabulary worth keeping; long passages are not. */
const isVocabulary = (text: string) => text.split(/\s+/).length <= 6 && text.length <= 80

const speak = (text: string, lang?: string) => {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  if (lang) u.lang = lang
  speechSynthesis.speak(u)
}

export const TranslationSheet = ({ target, onClose, onSaved, onRemoved }: Props) => {
  const settings = useSettings()
  const [result, setResult] = useState<TranslationResult | null>(null)
  const [error, setError] = useState<TranslateError | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState<Lookup | null>(null)
  const [copied, setCopied] = useState(false)
  const abort = useRef<AbortController | null>(null)
  // Keep the last content while the sheet animates closed.
  const lastTarget = useRef(target)
  if (target) lastTarget.current = target
  const shown = lastTarget.current

  const text = shown ? (shown.kind === 'new' ? shown.request.text : shown.lookup.text) : ''
  const context = shown ? (shown.kind === 'new' ? shown.request.context : shown.lookup.context) : ''
  const lang = shown?.kind === 'new' ? shown.request.bookLanguage : undefined

  const run = async (t: TranslationTarget, fresh = false) => {
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setLoading(true)
    setError(null)
    if (fresh) setResult(null)
    const request: TranslateRequest = t.kind === 'new'
      ? t.request
      : { text: t.lookup.text, context: t.lookup.context, targetLang: settings.targetLang, bookTitle: t.lookup.bookTitle }
    try {
      const r = await translate(request, { signal: ac.signal, fresh })
      if (ac.signal.aborted) return
      setResult(r)
      if (t.kind === 'saved') {
        const updated = { ...t.lookup, result: r, targetLang: request.targetLang }
        await putLookup(updated)
        setSaved(updated)
      } else if (isVocabulary(request.text)) {
        const lookup: Lookup = {
          id: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          bookId: t.bookId,
          bookTitle: request.bookTitle ?? '',
          text: request.text,
          context: request.context,
          cfi: t.cfi,
          sectionIndex: t.sectionIndex,
          targetLang: request.targetLang,
          result: r,
          createdAt: Date.now(),
        }
        await putLookup(lookup)
        setSaved(lookup)
        onSaved(lookup)
      }
    } catch (e) {
      if (ac.signal.aborted || (e as Error)?.name === 'AbortError') return
      console.error(e)
      setError(e instanceof TranslateError ? e : new TranslateError(String((e as Error)?.message ?? e), 'provider'))
    } finally {
      if (!ac.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!target) {
      abort.current?.abort()
      return
    }
    setCopied(false)
    if (target.kind === 'saved') {
      setResult(target.lookup.result)
      setSaved(target.lookup)
      setError(null)
      setLoading(false)
    } else {
      setResult(null)
      setSaved(null)
      run(target)
    }
  }, [target])

  const remove = async () => {
    if (!saved) return
    await deleteLookup(saved.id)
    onRemoved(saved)
    setSaved(null)
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.translation)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }

  const config = settings.providers[settings.provider]
  const isWord = isVocabulary(text)

  return (
    <Sheet open={!!target} onClose={onClose} label="Translation" class="translation-sheet">
      <div class="tr-head">
        <p class={`tr-source ${isWord ? 'word' : 'passage'}`} lang={lang}>{text}</p>
        {isWord && (
          <button class="icon-btn" onClick={() => speak(text, lang)} aria-label="Listen">
            <Icon name="volume" size={20} />
          </button>
        )}
      </div>
      {result && (result.transcription || result.partOfSpeech || result.lemma) && (
        <p class="tr-meta">
          {[result.transcription && `[${result.transcription}]`, result.partOfSpeech,
            result.lemma && result.lemma.toLowerCase() !== text.toLowerCase() && `← ${result.lemma}`]
            .filter(Boolean).join('  ·  ')}
        </p>
      )}

      <div class="tr-body" aria-live="polite">
        {loading && !result && (
          <div class="tr-loading" aria-label="Translating">
            <span class="shimmer" style="width: 62%" />
            <span class="shimmer" style="width: 84%" />
            <span class="shimmer" style="width: 40%" />
          </div>
        )}
        {error && (
          <div class="tr-error">
            <p>{error.message}</p>
            <div class="row">
              {(error.kind === 'config' || error.kind === 'auth') ? (
                <button class="btn" onClick={() => { onClose(); navigate('/settings') }}>Open settings</button>
              ) : shown && (
                <button class="btn" onClick={() => run(shown, true)}>Try again</button>
              )}
            </div>
          </div>
        )}
        {result && (
          <>
            <p class={`tr-translation ${isWord ? 'word' : 'passage'}`}>{result.translation}</p>
            {!!result.alternatives?.length && (
              <div class="tr-alts">
                {result.alternatives.map(a => <span class="chip" key={a}>{a}</span>)}
              </div>
            )}
            {result.note && <p class="tr-note">{result.note}</p>}
            {context && context !== text && (
              <details class="tr-context">
                <summary>Context</summary>
                <p lang={lang}>{highlight(context, text)}</p>
              </details>
            )}
          </>
        )}
      </div>

      <div class="tr-actions">
        <button class="btn ghost" onClick={copy} disabled={!result}>
          <Icon name={copied ? 'check' : 'copy'} size={18} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button class="btn ghost" onClick={() => shown && run(shown, true)} disabled={loading}>
          <Icon name="refresh" size={18} /> Retry
        </button>
        {saved && (
          <button class="btn ghost" onClick={remove}>
            <Icon name="trash" size={18} /> Forget
          </button>
        )}
        <span class="tr-provider">{PROVIDER_LABELS[settings.provider]} · {config.model} → {settings.targetLang}</span>
      </div>
    </Sheet>
  )
}

const highlight = (context: string, text: string) => {
  const i = context.toLowerCase().indexOf(text.toLowerCase())
  if (i < 0) return context
  return <>{context.slice(0, i)}<mark>{context.slice(i, i + text.length)}</mark>{context.slice(i + text.length)}</>
}
