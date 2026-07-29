import { useEffect, useRef, useState } from 'react'

// Renders a raw .excalidraw scene (JSON string) as an inline SVG. The heavy
// @excalidraw/excalidraw package is dynamically imported so it is code-split
// away from the initial bundle and only fetched when a diagram actually mounts.
// The .excalidraw files in ../../docs are the single source of truth — editing
// one and saving re-runs this via HMR, so the page never drifts from the art.
function ExcalidrawDiagram({
  scene,
  label,
  className,
}: {
  scene: string
  label?: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function render() {
      try {
        const { exportToSvg } = await import('@excalidraw/excalidraw')
        const data = JSON.parse(scene)
        const svg = await exportToSvg({
          elements: data.elements ?? [],
          appState: {
            ...(data.appState ?? {}),
            exportBackground: false,
          },
          files: data.files ?? null,
        })
        if (cancelled || !hostRef.current) return
        // Let the SVG scale to its container instead of its fixed export size.
        svg.removeAttribute('width')
        svg.removeAttribute('height')
        svg.style.maxWidth = '100%'
        svg.style.height = 'auto'
        hostRef.current.replaceChildren(svg)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    render()
    return () => {
      cancelled = true
    }
  }, [scene])

  const cls = `excalidraw-diagram${className ? ` ${className}` : ''}`

  if (error) {
    return <div className={`${cls} excalidraw-diagram-error`}>Diagram failed to render: {error}</div>
  }

  return <div className={cls} ref={hostRef} aria-label={label} role="img" />
}

export default ExcalidrawDiagram
