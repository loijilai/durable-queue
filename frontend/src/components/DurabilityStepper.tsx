import { useState } from 'react'
import type { StoryNode } from '../lib/durabilityStory.ts'
import { STEP_DIAGRAMS, type StepScenes } from '../lib/diagramScenes.ts'
import ExcalidrawDiagram from './ExcalidrawDiagram.tsx'

// Steps 1–3 share one architecture diagram whose layout never moves — only the
// annotations change. So instead of three stacked cards, we render one card with
// a fixed diagram frame and swap the active step in place. All three arch scenes
// are pre-rendered and toggled via CSS so clicking back and forth is instant and
// flicker-free — that A/B comparison is the whole point.
function DurabilityStepper({ nodes }: { nodes: StoryNode[] }) {
  const [active, setActive] = useState(0)
  const [showTimeline, setShowTimeline] = useState(false)

  const node = nodes[active]
  const scenes = STEP_DIAGRAMS[node.id as keyof typeof STEP_DIAGRAMS] as StepScenes | undefined

  function goTo(next: number) {
    setActive(next)
    setShowTimeline(false)
  }

  return (
    <div className="stepper">
      <div className="stepper-tabs" role="tablist" aria-label="Durability steps">
        {nodes.map((n, i) => (
          <button
            key={n.id}
            role="tab"
            aria-selected={i === active}
            className={`stepper-tab${i === active ? ' is-active' : ''}`}
            onClick={() => goTo(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <p className="eyebrow">
        <span className="eyebrow-dot" />
        {node.eyebrow}
      </p>
      <h3>{node.title}</h3>
      <p className="story-node-term">{node.term}</p>
      <p className="story-node-desc">{node.description}</p>

      <div className="stepper-frame">
        {nodes.map((n, i) => {
          const s = STEP_DIAGRAMS[n.id as keyof typeof STEP_DIAGRAMS] as StepScenes | undefined
          if (!s) return null
          return (
            <div key={n.id} className={`stepper-slide${i === active ? ' is-active' : ''}`} aria-hidden={i !== active}>
              <ExcalidrawDiagram scene={s.arch} label={`${n.id} architecture`} />
            </div>
          )
        })}
      </div>

      {scenes?.timeline && (
        <div className="stepper-timeline">
          <button
            className="stepper-timeline-toggle"
            aria-expanded={showTimeline}
            onClick={() => setShowTimeline((v) => !v)}
          >
            {showTimeline ? 'Hide timeline' : 'Show timeline'}
          </button>
          {showTimeline && (
            <ExcalidrawDiagram
              scene={scenes.timeline}
              label={`${node.id} timeline`}
              className="excalidraw-diagram-compact"
            />
          )}
        </div>
      )}
    </div>
  )
}

export default DurabilityStepper
