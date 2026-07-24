import type { StoryNodeId } from '../lib/durabilityStory.ts'
import { raceIdempotencyScene } from '../lib/diagramScenes.ts'
import ExcalidrawDiagram from './ExcalidrawDiagram.tsx'

// Diagrams for the standalone cards (steps 4 & 5). Steps 1–3 live in their own
// fixed-frame stepper (see DurabilityStepper.tsx).

// Step 5 (retry) has no excalidraw scene yet — a small CSS-box illustration of
// exponential backoff stands in until one is drawn.
function RetryDiagram() {
  const delays = [1, 2, 4, 8]
  return (
    <div className="diagram diagram-retry">
      {delays.map((d, i) => (
        <div key={d} className="retry-bar-track">
          <div
            className="retry-bar"
            style={{ height: `${16 + d * 10}px`, marginLeft: `${(i % 2) * 6}px` }}
          />
          <span className="diagram-box-sub">{d}s + jitter</span>
        </div>
      ))}
    </div>
  )
}

function StoryDiagram({ nodeId }: { nodeId: StoryNodeId }) {
  if (nodeId === 'race-idempotency') {
    return (
      <ExcalidrawDiagram
        scene={raceIdempotencyScene}
        label="race condition sequence"
        className="excalidraw-diagram-compact"
      />
    )
  }
  if (nodeId === 'retry') return <RetryDiagram />
  return null
}

export default StoryDiagram
