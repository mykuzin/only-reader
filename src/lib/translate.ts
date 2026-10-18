import type Anthropic from '@anthropic-ai/sdk'
import type { TranslationResult } from './db'
import { getCached, putCached } from './db'
import { getSettings, type ProviderConfig, type ProviderId } from './settings'

export type TranslateRequest = {
  text: string
  context: string
  targetLang: string
  bookTitle?: string
  bookAuthor?: string
  bookLanguage?: string
}

export class TranslateError extends Error {
  constructor(message: string, readonly kind: 'config' | 'auth' | 'network' | 'provider' | 'parse') {
    super(message)
  }
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    translation: { type: 'string' },
    lemma: { type: 'string' },
    partOfSpeech: { type: 'string' },
    transcription: { type: 'string' },
    alternatives: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
    sourceLanguage: { type: 'string' },
  },
  required: ['translation'],
  additionalProperties: false,
}

const systemPrompt = (target: string) => `You are the translation engine inside an e-book reader. While reading, the user selected a word or passage and wants to understand it in ${target}.

- Translate the selected text into ${target}, choosing the sense that fits the surrounding context. The context is given only to disambiguate; do not translate it.
- If the selection is a single word or a short fixed expression (up to about four words), also give: "lemma" (the dictionary form in the source language, omit if identical to the selection), "partOfSpeech" (written in ${target}), "transcription" (IPA of the source-language selection, without slashes), "alternatives" (up to three other common ${target} translations of the selection), and "note" (one or two short sentences in ${target} explaining what it means here; mention idioms, phrasal verbs, slang, archaic usage or wordplay when relevant).
- For a longer passage, give a natural, faithful translation that reads well in ${target}. Add a "note" only when an idiom, cultural reference or ambiguity is worth explaining, and leave out lemma, partOfSpeech, transcription and alternatives.
- "sourceLanguage" is the English name of the selection's language.
- Answer with a single JSON object and nothing else, using exactly these keys: translation, lemma, partOfSpeech, transcription, alternatives, note, sourceLanguage. Omit keys that do not apply.`

const userPrompt = (r: TranslateRequest) => [
  r.bookTitle ? `Book: ${r.bookTitle}${r.bookAuthor ? ` by ${r.bookAuthor}` : ''}` : '',
  r.bookLanguage ? `Book language: ${r.bookLanguage}` : '',
  r.context && r.context !== r.text ? `Context: «${r.context}»` : '',
  `Selected text: «${r.text}»`,
].filter(Boolean).join('\n')

const parseResult = (raw: string): TranslationResult => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) {
    // Some models ignore the JSON instruction for long passages: accept plain text.
    const text = raw.trim()
    if (text) return { translation: text }
    throw new TranslateError('The model returned an empty answer.', 'parse')
  }
  try {
    const obj = JSON.parse(raw.slice(start, end + 1))
    if (typeof obj.translation !== 'string' || !obj.translation.trim())
      throw new Error('missing translation')
    return {
      translation: obj.translation.trim(),
      lemma: str(obj.lemma),
      partOfSpeech: str(obj.partOfSpeech),
      transcription: str(obj.transcription)?.replace(/^\/|\/$/g, ''),
      alternatives: Array.isArray(obj.alternatives)
        ? obj.alternatives.filter((x: unknown) => typeof x === 'string' && x.trim()).slice(0, 3)
        : undefined,
      note: str(obj.note),
      sourceLanguage: str(obj.sourceLanguage),
    }
  } catch {
    throw new TranslateError('Could not read the model\'s answer. Try again or pick another model.', 'parse')
  }
}

const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : undefined)

const httpError = async (res: Response): Promise<TranslateError> => {
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.error?.message ?? body?.message ?? ''
  } catch { /* not JSON */ }
  const kind = res.status === 401 || res.status === 403 ? 'auth' : 'provider'
  const prefix = kind === 'auth' ? 'The API key was rejected' : `The provider returned ${res.status}`
  return new TranslateError(detail ? `${prefix}: ${detail}` : `${prefix}.`, kind)
}

const guardedFetch = async (url: string, init: RequestInit) => {
  try {
    return await fetch(url, init)
  } catch {
    throw new TranslateError(
      navigator.onLine ? 'Could not reach the provider. Check the base URL.' : 'You are offline.',
      'network')
  }
}

// --- OpenAI-compatible (OpenAI, OpenRouter, DeepSeek, Groq, Ollama, LM Studio...) ---

const openaiBase = (c: ProviderConfig) => (c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')

const openaiTranslate = async (c: ProviderConfig, r: TranslateRequest, signal?: AbortSignal,
  extraHeaders: Record<string, string> = {}) => {
  const body: Record<string, unknown> = {
    model: c.model,
    messages: [
      { role: 'system', content: systemPrompt(r.targetLang) },
      { role: 'user', content: userPrompt(r) },
    ],
    response_format: { type: 'json_object' },
  }
  const send = () => guardedFetch(`${openaiBase(c)}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}`, ...extraHeaders },
    body: JSON.stringify(body),
  })
  let res = await send()
  // Not every compatible server implements response_format; retry without it.
  if (res.status === 400 || res.status === 422) {
    delete body.response_format
    res = await send()
  }
  if (!res.ok) throw await httpError(res)
  const data = await res.json()
  return parseResult(data?.choices?.[0]?.message?.content ?? '')
}

const openaiModels = async (c: ProviderConfig) => {
  const res = await guardedFetch(`${openaiBase(c)}/models`, {
    headers: { Authorization: `Bearer ${c.apiKey}` },
  })
  if (!res.ok) throw await httpError(res)
  const data = await res.json()
  return (data?.data ?? []).map((m: { id: string }) => m.id).sort() as string[]
}

// --- Anthropic Claude (official SDK, loaded only when used) ---

let anthropicClient: { key: string; client: Anthropic } | undefined

const getAnthropic = async (apiKey: string) => {
  if (anthropicClient?.key === apiKey) return anthropicClient.client
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  // The key belongs to the user and never leaves their device except to Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 })
  anthropicClient = { key: apiKey, client }
  return client
}

// Models that accept `output_config.effort` / server-side refusal fallbacks.
const supportsEffort = (m: string) =>
  /^claude-(fable|mythos|opus|sonnet|haiku)-5/.test(m) || /^claude-(opus|sonnet)-4-[6-9]/.test(m)
const supportsFallbacks = (m: string) =>
  /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/.test(m)

const anthropicTranslate = async (c: ProviderConfig, r: TranslateRequest, signal?: AbortSignal) => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = await getAnthropic(c.apiKey)
  const params = {
    model: c.model,
    max_tokens: 16000,
    system: systemPrompt(r.targetLang),
    messages: [{ role: 'user' as const, content: userPrompt(r) }],
    output_config: {
      format: { type: 'json_schema' as const, schema: RESULT_SCHEMA },
      // A lookup should feel instant; translation needs little deliberation.
      ...(supportsEffort(c.model) ? { effort: 'low' as const } : {}),
    },
  }
  type Reply = Pick<Anthropic.Message, 'stop_reason' | 'content'>
    | Pick<Anthropic.Beta.BetaMessage, 'stop_reason' | 'content'>
  const send = async (p: typeof params): Promise<Reply> => supportsFallbacks(c.model)
    ? client.beta.messages.create(
        { ...p, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : client.messages.create(p, { signal })
  try {
    const message = await send(params).catch(e => {
      // Older models reject structured outputs; the prompt alone asks for JSON.
      if (!(e instanceof Anthropic.BadRequestError)) throw e
      const { format: _, ...rest } = params.output_config
      return send({ ...params, output_config: rest } as typeof params)
    })
    if (message.stop_reason === 'refusal')
      throw new TranslateError('Claude declined to translate this passage.', 'provider')
    const text = message.content
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
    return parseResult(text)
  } catch (e) {
    if (e instanceof TranslateError) throw e
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
      throw new TranslateError(`The API key was rejected: ${e.message}`, 'auth')
    if (e instanceof Anthropic.NotFoundError)
      throw new TranslateError(`Model "${c.model}" was not found. Pick another one in Settings.`, 'config')
    if (e instanceof Anthropic.RateLimitError)
      throw new TranslateError('Rate limited by Anthropic. Wait a moment and try again.', 'provider')
    if (e instanceof Anthropic.APIConnectionError)
      throw new TranslateError(navigator.onLine ? 'Could not reach Anthropic.' : 'You are offline.', 'network')
    if (e instanceof Anthropic.APIError)
      throw new TranslateError(`Anthropic returned ${e.status}: ${e.message}`, 'provider')
    throw e
  }
}

const anthropicModels = async (c: ProviderConfig) => {
  const client = await getAnthropic(c.apiKey)
  const ids: string[] = []
  for await (const m of client.models.list()) ids.push(m.id)
  return ids
}

// --- Google Gemini ---

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta'

const geminiTranslate = async (c: ProviderConfig, r: TranslateRequest, signal?: AbortSignal) => {
  const model = c.model.replace(/^models\//, '')
  const res = await guardedFetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(r.targetLang) }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt(r) }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw await httpError(res)
  const data = await res.json()
  const text = (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '').join('')
  if (!text && data?.promptFeedback?.blockReason)
    throw new TranslateError(`Gemini blocked the request (${data.promptFeedback.blockReason}).`, 'provider')
  return parseResult(text)
}

const geminiModels = async (c: ProviderConfig) => {
  const res = await guardedFetch(`${GEMINI}/models?pageSize=1000`, {
    headers: { 'x-goog-api-key': c.apiKey },
  })
  if (!res.ok) throw await httpError(res)
  const data = await res.json()
  return (data?.models ?? [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes('generateContent'))
    .map((m: { name: string }) => m.name.replace(/^models\//, '')) as string[]
}

// --- OpenRouter: one key for hundreds of models, OpenAI-compatible API ---

const OPENROUTER = 'https://openrouter.ai/api/v1'

const openrouterTranslate = (c: ProviderConfig, r: TranslateRequest, signal?: AbortSignal) =>
  openaiTranslate({ ...c, baseUrl: OPENROUTER }, r, signal, {
    // Optional attribution headers OpenRouter uses for its app rankings.
    'HTTP-Referer': location.origin,
    'X-Title': 'Only Reader',
  })

const openrouterModels = (c: ProviderConfig) => openaiModels({ ...c, baseUrl: OPENROUTER })

// --- Public API ---

const PROVIDERS: Record<ProviderId, {
  translate: (c: ProviderConfig, r: TranslateRequest, s?: AbortSignal) => Promise<TranslationResult>
  models: (c: ProviderConfig) => Promise<string[]>
}> = {
  openai: { translate: openaiTranslate, models: openaiModels },
  openrouter: { translate: openrouterTranslate, models: openrouterModels },
  anthropic: { translate: anthropicTranslate, models: anthropicModels },
  gemini: { translate: geminiTranslate, models: geminiModels },
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: 'Claude',
  openrouter: 'OpenRouter',
  gemini: 'Gemini',
  openai: 'OpenAI / other',
}

const cacheKey = (p: ProviderId, c: ProviderConfig, r: TranslateRequest) =>
  [p, c.model, r.targetLang, r.text.trim().toLowerCase(), r.context.trim()].join('␟')

export const translate = async (r: TranslateRequest, opts: { signal?: AbortSignal; fresh?: boolean } = {}) => {
  const { provider, providers } = getSettings()
  const config = providers[provider]
  if (!config.apiKey.trim())
    throw new TranslateError(`Add your ${PROVIDER_LABELS[provider]} API key in Settings to translate.`, 'config')
  if (!config.model.trim())
    throw new TranslateError('Choose a model in Settings.', 'config')
  if (!r.targetLang.trim())
    throw new TranslateError('Choose a language to translate into in Settings.', 'config')

  const key = cacheKey(provider, config, r)
  if (!opts.fresh) {
    const cached = await getCached(key)
    if (cached) return cached
  }
  const result = await PROVIDERS[provider].translate(config, r, opts.signal)
  await putCached(key, result)
  return result
}

export const listModels = (provider: ProviderId, config: ProviderConfig) => {
  if (!config.apiKey.trim()) throw new TranslateError('Enter the API key first.', 'config')
  return PROVIDERS[provider].models(config)
}
