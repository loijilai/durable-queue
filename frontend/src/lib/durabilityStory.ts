export type StoryNodeId =
  | 'crash'
  | 'detect-death'
  | 'timeout-tradeoff'
  | 'idempotency'
  | 'locking'
  | 'retry'
  | 'synthesis'

export interface StoryNode {
  id: StoryNodeId
  eyebrow: string
  title: string
  problem: string
  requirement: string
  solution: string
}

// Each node exists because the previous node's solution opened a new failure mode.
// This is the causal chain, not a checklist — the order matters.
export const STORY_NODES: StoryNode[] = [
  {
    id: 'crash',
    eyebrow: 'STEP 1',
    title: 'A worker can die mid-task',
    problem:
      'Async workers get killed mid-task — a deploy, an OOM, a crash. An in-process retry loop (try/except in a loop) dies with the process. Nothing survives to say "this job is not done yet."',
    requirement:
      'The fact that a job is unfinished cannot live only inside one process\'s memory.',
    solution:
      'Split the system in two: a Broker for ephemeral dispatch (who is working on what, right now) and a DB for durable state (what actually happened). If the broker forgets, the DB still remembers.',
  },
  {
    id: 'detect-death',
    eyebrow: 'STEP 2',
    title: 'The broker cannot see a heartbeat',
    problem:
      'The broker handed a job to a worker and has no direct signal for "is this worker still alive and working," or "did it quietly die."',
    requirement:
      'Detect a dead worker without waiting forever, and without a live heartbeat channel.',
    solution:
      'Visibility timeout / lease: a job that is claimed gets a time-boxed lease. If it is not acknowledged before the lease expires, the broker assumes the worker died and makes the job visible again.',
  },
  {
    id: 'timeout-tradeoff',
    eyebrow: 'STEP 3',
    title: 'The timeout is a guess',
    problem:
      'Set the lease too short, and a worker that is still alive and working gets its job reassigned mid-flight. Set it too long, and a real crash takes forever to recover from.',
    requirement:
      'Accept that there is no free lunch here — the delivery guarantee downgrades from exactly-once to at-least-once.',
    solution:
      'Design for at-least-once from the start, rather than chasing an exactly-once guarantee that a lease-based system cannot actually provide.',
  },
  {
    id: 'idempotency',
    eyebrow: 'STEP 4',
    title: 'At-least-once means duplicates',
    problem:
      'If two workers can end up holding the same job (one thought-dead worker finishes late, right after a second worker picked it up), the job can execute twice.',
    requirement: 'Running the same job twice must not produce a wrong result.',
    solution:
      'Idempotency as a safety net: writes are structured so a duplicate execution is a no-op or converges to the same end state, not a double-charge / double-write.',
  },
  {
    id: 'locking',
    eyebrow: 'STEP 5',
    title: 'Two workers, one row, at the same time',
    problem:
      'Even without a full duplicate execution, two workers can race on the same job row: both read "claimable," both act on that stale read (check-then-act).',
    requirement:
      'The read inside a check-then-act needs to be serialized, not just the write.',
    solution:
      'SELECT ... FOR UPDATE inside a transaction. The lock does not protect the write — Postgres already serializes writes. It protects the read: it blocks the second worker\'s read until the first transaction commits, so the second worker\'s decision is based on the truth, not stale state.',
  },
  {
    id: 'retry',
    eyebrow: 'STEP 6',
    title: 'Sometimes nothing crashed — the API just failed',
    problem:
      'A worker can be perfectly alive and still fail: OpenAI rate-limits it, or times out. This is not a crash-recovery problem, it is a transient-failure problem.',
    requirement:
      'Retry the failure without every worker retrying in lockstep and slamming the API at the same moment.',
    solution:
      'Exponential backoff with jitter, capped by max_retries. When retries are exhausted, the job lands in FAILED — the DB row itself is the dead-letter, not a separate queue.',
  },
  {
    id: 'synthesis',
    eyebrow: 'THE POINT',
    title: 'Durability is a composition, not a mechanism',
    problem:
      'None of the six mechanisms above solves durability by itself.',
    requirement:
      'Be able to say, precisely, what each layer is defending against.',
    solution:
      'Broker (who is doing what) + DB (final truth) + Idempotency (duplicate-safety net) + Locking (concurrency-safety net). Remove any one layer and the system still "looks like it works" — until a worker dies at exactly the wrong moment.',
  },
]
