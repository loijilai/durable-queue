// Raw .excalidraw scenes imported straight from ../../docs — those files are the
// single source of truth for the durability diagrams. This module is their one
// home; components import the maps below rather than re-importing the raw files.

import queueArch from '../../../docs/1-queue-arch.excalidraw?raw'
import workerFailure from '../../../docs/2-worker-failure.excalidraw?raw'
import visibilityTimeout from '../../../docs/2-1-visibility-timeout.excalidraw?raw'
import workerStuckDuplicate from '../../../docs/3-worker-stuck-duplicate.excalidraw?raw'
import raceCondition from '../../../docs/3-1-race-condition.excalidraw?raw'
import sequenceConcurrency from '../../../docs/4-sequence-concurrency.excalidraw?raw'
import authSequenceGoogleOidc from '../../../docs/auth-sequence-google-oidc.excalidraw?raw'
import authAttackState from '../../../docs/8-auth-attack-1-state.excalidraw?raw'
import authAttackToken from '../../../docs/8-auth-attack-2-token.excalidraw?raw'
import authAttackLinking from '../../../docs/8-auth-attack-3-linking.excalidraw?raw'
import scaleOut from '../../../docs/5-scale-out.excalidraw?raw'

export interface StepScenes {
  // The architecture diagram — steps 1–3 all share this same layout, only the
  // annotations differ, which is what makes the fixed-frame stepper work.
  arch: string
  // Optional deeper sequence/timeline diagram, shown behind a toggle.
  timeline?: string
}

// Steps 1–3 (the fixed-frame stepper group).
export const STEP_DIAGRAMS = {
  crash: { arch: queueArch },
  'detect-death': { arch: workerFailure, timeline: visibilityTimeout },
  'at-least-once': { arch: workerStuckDuplicate, timeline: raceCondition },
} satisfies Record<string, StepScenes>

// Step 4 (race-idempotency) — a standalone sequence diagram card.
export const raceIdempotencyScene = sequenceConcurrency

// Auth page — Google OIDC authorization-code login sequence (RFC-worded).
export const authSequenceScene = authSequenceGoogleOidc

// Security page § APP — the same login sequence ghosted down to one attack at a
// time. Derived from the scene above by docs/8-auth-attacks.build.py, so they
// cannot drift from it; never hand-edit the three files.
export const AUTH_ATTACK_SCENES = {
  state: authAttackState,
  token: authAttackToken,
  linking: authAttackLinking,
} satisfies Record<string, string>

// Scalability page — producer → queue → fan-out to a worker pool that scales out.
export const scaleOutScene = scaleOut
