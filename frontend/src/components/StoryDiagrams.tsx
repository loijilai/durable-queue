import type { StoryNodeId } from '../lib/durabilityStory.ts'
import { raceIdempotencyScene } from '../lib/diagramScenes.ts'
import ExcalidrawDiagram from './ExcalidrawDiagram.tsx'

// Diagram for the standalone card (step 4). Steps 1–3 live in their own
// fixed-frame stepper (see DurabilityStepper.tsx).

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
  return null
}

export default StoryDiagram
