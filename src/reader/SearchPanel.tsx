import { useEffect, useRef, useState } from 'preact/hooks'
import type { FoliateView, SearchExcerpt } from '../lib/foliate'
import { Icon } from '../ui/icons'

type Hit = { cfi: string; excerpt: SearchExcerpt; label?: string }

export const SearchPanel = ({ view, onPick }: { view: FoliateView; onPick: (cfi: string) => void }) => {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const run = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => input.current?.focus(), 250) }, [])

  const search = async (e: Event) => {
    e.preventDefault()
    const q = query.trim()
    const id = ++run.current
    view.clearSearch()
    setHits([])
    if (q.length < 2) return
    setProgress(0)
    const found: Hit[] = []
    try {
      for await (const r of view.search({ query: q })) {
        if (id !== run.current) return
        if (r === 'done') break
        if ('progress' in r) setProgress(r.progress)
        else if ('subitems' in r) {
          found.push(...r.subitems.map(s => ({ ...s, label: r.label })))
          setHits([...found])
        } else if ('cfi' in r) {
          found.push(r)
          setHits([...found])
        }
        if (found.length >= 500) break
      }
    } finally {
      if (id === run.current) setProgress(null)
    }
  }

  return (
    <div class="search-panel">
      <form class="search-form" onSubmit={search}>
        <Icon name="search" size={18} />
        <input ref={input} type="search" placeholder="Search in book" value={query} enterKeyHint="search"
          onInput={e => setQuery((e.target as HTMLInputElement).value)} />
      </form>
      {progress != null && <div class="search-progress" style={{ transform: `scaleX(${progress})` }} />}
      <p class="muted small">
        {progress != null ? 'Searching…' : query.trim().length >= 2 && run.current ? `${hits.length} results` : ''}
      </p>
      <ul class="search-results">
        {hits.map((h, i) => (
          <li key={`${h.cfi}-${i}`}>
            <button onClick={() => onPick(h.cfi)}>
              {h.label && <span class="hit-label">{h.label}</span>}
              <span class="hit-text">
                {h.excerpt.pre}<mark>{h.excerpt.match}</mark>{h.excerpt.post}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
