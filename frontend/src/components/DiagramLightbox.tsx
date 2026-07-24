import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import ExcalidrawDiagram from './ExcalidrawDiagram.tsx'

const MIN_SCALE = 0.5
const MAX_SCALE = 3
const STEP = 0.25

// Full-screen overlay for reading a dense diagram at native resolution. The
// diagram is vector (SVG), so zooming stays crisp. Zoom is expressed as the
// canvas width (scale × 100% of the scroll viewport); anything over 100%
// overflows and is panned by dragging or scrolling.
function DiagramLightbox({
  scene,
  label,
  onClose,
}: {
  scene: string
  label: string
  onClose: () => void
}) {
  const [scale, setScale] = useState(1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null)

  // Close on Escape, and lock background scroll while the overlay is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  const zoom = (delta: number) =>
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 100) / 100)))

  // Drag-to-pan: translate pointer movement into scroll offset on the viewport.
  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const el = scrollRef.current
    if (!el) return
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const el = scrollRef.current
    if (!el || !drag.current) return
    el.scrollLeft = drag.current.left - (e.clientX - drag.current.x)
    el.scrollTop = drag.current.top - (e.clientY - drag.current.y)
  }
  function endDrag() {
    drag.current = null
  }

  return createPortal(
    <div className="lightbox-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <div className="lightbox-toolbar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-title">{label}</span>
        <div className="lightbox-controls">
          <button type="button" onClick={() => zoom(-STEP)} aria-label="Zoom out">–</button>
          <button type="button" onClick={() => setScale(1)}>{Math.round(scale * 100)}%</button>
          <button type="button" onClick={() => zoom(STEP)} aria-label="Zoom in">+</button>
          <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <div
        className="lightbox-scroll"
        ref={scrollRef}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="lightbox-canvas" style={{ width: `${scale * 100}%` }}>
          <ExcalidrawDiagram scene={scene} label={label} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default DiagramLightbox
