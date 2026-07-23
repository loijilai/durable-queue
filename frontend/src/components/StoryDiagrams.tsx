import type { JSX } from 'react'
import type { StoryNodeId } from '../lib/durabilityStory.ts'

// Small, deliberately simple diagrams — CSS boxes + arrows, not a charting
// library. Each one visualizes exactly the failure mode its story node
// describes, nothing more.

function BrokerDbDiagram() {
  return (
    <div className="diagram diagram-broker-db">
      <div className="diagram-box diagram-box-dying">
        <span className="diagram-box-label">Worker</span>
        <span className="diagram-box-sub">dies mid-task</span>
      </div>
      <span className="diagram-arrow diagram-arrow-broken">✕</span>
      <div className="diagram-box diagram-box-broker">
        <span className="diagram-box-label">Broker</span>
        <span className="diagram-box-sub">ephemeral dispatch</span>
      </div>
      <span className="diagram-arrow">⇄</span>
      <div className="diagram-box diagram-box-db">
        <span className="diagram-box-label">DB</span>
        <span className="diagram-box-sub">durable truth</span>
      </div>
    </div>
  )
}

function VisibilityTimeoutDiagram() {
  return (
    <div className="diagram diagram-timeout">
      <div className="timeout-ring">
        <span className="timeout-ring-label">lease</span>
      </div>
      <span className="diagram-arrow">→</span>
      <div className="diagram-box diagram-box-broker">
        <span className="diagram-box-label">Job visible again</span>
        <span className="diagram-box-sub">reassigned to another worker</span>
      </div>
    </div>
  )
}

function TradeoffDiagram() {
  return (
    <div className="diagram diagram-tradeoff">
      <div className="tradeoff-row">
        <span className="tradeoff-tag tradeoff-tag-short">too short</span>
        <div className="tradeoff-bar tradeoff-bar-short" />
        <span className="diagram-box-sub">live worker gets reassigned</span>
      </div>
      <div className="tradeoff-row">
        <span className="tradeoff-tag tradeoff-tag-long">too long</span>
        <div className="tradeoff-bar tradeoff-bar-long" />
        <span className="diagram-box-sub">real crash recovers slowly</span>
      </div>
    </div>
  )
}

function IdempotencyDiagram() {
  return (
    <div className="diagram diagram-idempotency">
      <div className="diagram-box diagram-box-broker">
        <span className="diagram-box-label">Execute #1</span>
      </div>
      <div className="diagram-box diagram-box-broker">
        <span className="diagram-box-label">Execute #2 (duplicate)</span>
      </div>
      <span className="diagram-arrow">↓ ↓</span>
      <div className="diagram-box diagram-box-guard">
        <span className="diagram-box-label">Idempotency guard</span>
        <span className="diagram-box-sub">same end state either way</span>
      </div>
    </div>
  )
}

function LockingDiagram() {
  return (
    <div className="diagram diagram-locking">
      <div className="lock-lane">
        <span className="lock-lane-label">Worker A</span>
        <div className="lock-bar lock-bar-active">SELECT … FOR UPDATE → commit</div>
      </div>
      <div className="lock-lane">
        <span className="lock-lane-label">Worker B</span>
        <div className="lock-bar lock-bar-waiting">read blocked until A commits</div>
      </div>
    </div>
  )
}

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

function SynthesisDiagram() {
  const layers = [
    { label: 'Broker', sub: 'who is doing what' },
    { label: 'DB', sub: 'final truth' },
    { label: 'Idempotency', sub: 'duplicate-safety net' },
    { label: 'Locking', sub: 'concurrency-safety net' },
  ]
  return (
    <div className="diagram diagram-synthesis">
      <div className="synthesis-grid">
        {layers.map((l) => (
          <div key={l.label} className="diagram-box diagram-box-broker">
            <span className="diagram-box-label">{l.label}</span>
            <span className="diagram-box-sub">{l.sub}</span>
          </div>
        ))}
      </div>
      <span className="diagram-arrow">↓</span>
      <div className="diagram-box diagram-box-db diagram-box-wide">
        <span className="diagram-box-label">Durability</span>
      </div>
    </div>
  )
}

const DIAGRAMS: Record<StoryNodeId, () => JSX.Element> = {
  crash: BrokerDbDiagram,
  'detect-death': VisibilityTimeoutDiagram,
  'timeout-tradeoff': TradeoffDiagram,
  idempotency: IdempotencyDiagram,
  locking: LockingDiagram,
  retry: RetryDiagram,
  synthesis: SynthesisDiagram,
}

function StoryDiagram({ nodeId }: { nodeId: StoryNodeId }) {
  const Diagram = DIAGRAMS[nodeId]
  return <Diagram />
}

export default StoryDiagram
