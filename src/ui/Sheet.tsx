import type { ComponentChildren } from 'preact'
import { useEffect, useRef } from 'preact/hooks'

type Props = {
  open: boolean
  onClose: () => void
  children: ComponentChildren
  side?: 'bottom' | 'left'
  label: string
  class?: string
}

/** Bottom sheet (or side drawer) with a scrim; swipe down to dismiss. */
export const Sheet = ({ open, onClose, children, side = 'bottom', label, class: cls = '' }: Props) => {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; dy: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open, onClose])

  const onTouchStart = (e: TouchEvent) => {
    const el = ref.current
    if (side !== 'bottom' || !el || el.scrollTop > 0) return
    drag.current = { y: e.touches[0].clientY, dy: 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    const d = drag.current
    if (!d || !ref.current) return
    d.dy = Math.max(0, e.touches[0].clientY - d.y)
    ref.current.style.transform = `translateY(${d.dy}px)`
    ref.current.style.transition = 'none'
  }
  const onTouchEnd = () => {
    const d = drag.current
    drag.current = null
    if (!d || !ref.current) return
    ref.current.style.transform = ''
    ref.current.style.transition = ''
    if (d.dy > 90) onClose()
  }

  return (
    <div class={`sheet-root ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div class="scrim" onClick={onClose} />
      <div ref={ref} class={`sheet sheet-${side} ${cls}`} role="dialog" aria-label={label} aria-modal="true"
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {side === 'bottom' && <div class="grabber" />}
        {children}
      </div>
    </div>
  )
}
