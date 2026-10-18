import type { ComponentChildren } from 'preact'
import type { Settings, Theme } from '../lib/settings'
import { PALETTES } from './bookStyles'

type Props = { settings: Settings; fixedLayout: boolean; onChange: (patch: Partial<Settings>) => void }

const THEMES: { id: Theme; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'dark', label: 'Dark' },
  { id: 'black', label: 'Black' },
]

export function Segmented<T extends string | number>({ value, options, onChange, label }:
  { value: T; options: { value: T; label: ComponentChildren }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value}
          class={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export const Toggle = ({ checked, onChange, children }:
  { checked: boolean; onChange: (v: boolean) => void; children: ComponentChildren }) => (
  <label class="toggle">
    <span>{children}</span>
    <input type="checkbox" role="switch" checked={checked}
      onChange={e => onChange((e.target as HTMLInputElement).checked)} />
    <span class="track" aria-hidden="true" />
  </label>
)

export const TypographyPanel = ({ settings: s, fixedLayout, onChange }: Props) => (
  <div class="type-panel">
    <div class="themes" role="radiogroup" aria-label="Theme">
      {THEMES.map(t => {
        const p = t.id === 'auto' ? null : PALETTES[t.id]
        return (
          <button key={t.id} role="radio" aria-checked={s.theme === t.id}
            class={`theme-swatch ${s.theme === t.id ? 'on' : ''} ${t.id}`}
            style={p ? { background: p.bg, color: p.fg } : undefined}
            onClick={() => onChange({ theme: t.id })}>
            <span class="aa">Aa</span>
            <span class="name">{t.label}</span>
          </button>
        )
      })}
    </div>

    {fixedLayout ? (
      <div class="field">
        <span class="field-label">Zoom</span>
        <Segmented label="Zoom" value={s.fxlZoom} onChange={v => onChange({ fxlZoom: v })}
          options={[{ value: 'fit-page', label: 'Fit page' }, { value: 'fit-width', label: 'Fit width' }]} />
      </div>
    ) : (
      <>
        <div class="field">
          <span class="field-label">Size</span>
          <div class="stepper">
            <button aria-label="Smaller text" onClick={() => onChange({ fontSize: Math.max(70, s.fontSize - 10) })}>
              <span style="font-size: 14px">A</span>
            </button>
            <span class="value">{s.fontSize}%</span>
            <button aria-label="Larger text" onClick={() => onChange({ fontSize: Math.min(250, s.fontSize + 10) })}>
              <span style="font-size: 20px">A</span>
            </button>
          </div>
        </div>

        <div class="field">
          <span class="field-label">Font</span>
          <Segmented label="Font" value={s.font} onChange={v => onChange({ font: v })} options={[
            { value: 'literata', label: <span style="font-family: 'Literata Variable', serif">Literata</span> },
            { value: 'serif', label: <span style="font-family: Georgia, serif">Serif</span> },
            { value: 'sans', label: <span style="font-family: system-ui, sans-serif">Sans</span> },
            { value: 'publisher', label: 'Original' },
          ]} />
        </div>

        <div class="field">
          <span class="field-label">Spacing</span>
          <Segmented label="Line spacing" value={s.lineHeight} onChange={v => onChange({ lineHeight: v })} options={[
            { value: 1.3, label: 'Tight' }, { value: 1.5, label: 'Normal' }, { value: 1.75, label: 'Loose' },
          ]} />
        </div>

        <div class="field">
          <span class="field-label">Margins</span>
          <Segmented label="Margins" value={s.margin} onChange={v => onChange({ margin: v })} options={[
            { value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' },
          ]} />
        </div>

        <div class="field">
          <span class="field-label">Layout</span>
          <Segmented label="Layout" value={s.flow} onChange={v => onChange({ flow: v })} options={[
            { value: 'paginated', label: 'Pages' }, { value: 'scrolled', label: 'Scroll' },
          ]} />
        </div>

        <Toggle checked={s.justify} onChange={v => onChange({ justify: v })}>Justify text</Toggle>
        <Toggle checked={s.hyphenate} onChange={v => onChange({ hyphenate: v })}>Hyphenation</Toggle>
      </>
    )}
    <Toggle checked={s.underlineLookups} onChange={v => onChange({ underlineLookups: v })}>
      Underline translated words
    </Toggle>
  </div>
)
