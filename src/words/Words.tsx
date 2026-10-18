import { useEffect, useMemo, useState } from 'preact/hooks'
import { deleteLookup, listLookups, type Lookup } from '../lib/db'
import { goBack, navigate } from '../router'
import { Icon } from '../ui/icons'

const csvCell = (s = '') => `"${s.replace(/"/g, '""')}"`

/** Anki-friendly CSV: front, back, context, book. */
const exportCsv = (items: Lookup[]) => {
  const rows = items.map(l => [
    l.text,
    [l.result.translation, l.result.alternatives?.join(', '), l.result.note].filter(Boolean).join(' — '),
    l.context,
    l.bookTitle,
  ].map(csvCell).join(','))
  const blob = new Blob(['﻿' + ['Word,Translation,Context,Book', ...rows].join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `words-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export const Words = () => {
  const [items, setItems] = useState<Lookup[] | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => { listLookups().then(setItems) }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!items || !q) return items ?? []
    return items.filter(l => l.text.toLowerCase().includes(q) || l.result.translation.toLowerCase().includes(q))
  }, [items, query])

  const remove = async (l: Lookup) => {
    await deleteLookup(l.id)
    setItems(xs => xs?.filter(x => x.id !== l.id) ?? null)
  }

  return (
    <div class="page words">
      <header class="app-bar">
        <button class="icon-btn" onClick={goBack} aria-label="Back"><Icon name="back" /></button>
        <h1>Words</h1>
        <div class="actions">
          <button class="icon-btn" onClick={() => items && exportCsv(filtered)} disabled={!filtered.length}
            aria-label="Export as CSV" title="Export as CSV (Anki)">
            <Icon name="download" />
          </button>
        </div>
      </header>

      <main class="page-body">
        {items && !items.length && (
          <div class="empty">
            <h2>No words yet</h2>
            <p>Words and short phrases you translate while reading are collected here, with the sentence
              they came from.</p>
          </div>
        )}
        {!!items?.length && (
          <>
            <div class="search-form">
              <Icon name="search" size={18} />
              <input type="search" placeholder={`Search ${items.length} words`} value={query}
                onInput={e => setQuery((e.target as HTMLInputElement).value)} />
            </div>
            <ul class="word-list">
              {filtered.map(l => (
                <li key={l.id} class={open === l.id ? 'open' : ''}>
                  <button class="word-row" onClick={() => setOpen(o => (o === l.id ? null : l.id))}>
                    <span class="w">{l.text}</span>
                    <span class="t">{l.result.translation}</span>
                  </button>
                  {open === l.id && (
                    <div class="word-detail">
                      {(l.result.transcription || l.result.partOfSpeech) && (
                        <p class="tr-meta">
                          {[l.result.transcription && `[${l.result.transcription}]`, l.result.partOfSpeech]
                            .filter(Boolean).join('  ·  ')}
                        </p>
                      )}
                      {!!l.result.alternatives?.length && <p>{l.result.alternatives.join(', ')}</p>}
                      {l.result.note && <p class="tr-note">{l.result.note}</p>}
                      {l.context && <p class="ctx">“{l.context}”</p>}
                      <div class="row">
                        <span class="muted small">{l.bookTitle}</span>
                        <span class="spacer" />
                        {l.cfi && (
                          <button class="btn ghost small" onClick={() => navigate(`/read/${l.bookId}`)}>Open book</button>
                        )}
                        <button class="btn ghost small" onClick={() => remove(l)}>
                          <Icon name="trash" size={16} /> Forget
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  )
}
