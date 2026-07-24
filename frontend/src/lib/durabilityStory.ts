export type StoryNodeId =
  | "crash"
  | "detect-death"
  | "at-least-once"
  | "race-idempotency"
  | "retry";

export interface StoryNode {
  id: StoryNodeId;
  eyebrow: string;
  title: string;
  term: string;
  description: string;
}

// Each step exists because the previous step's solution opened a new failure mode.
// This is the causal chain, not a checklist — the order matters. On-screen text is
// intentionally minimal (context sentence + key term); the rest is narrated live.
export const STORY_NODES: StoryNode[] = [
  {
    id: "crash",
    eyebrow: "STEP 1",
    title: "A worker can die mid-task",
    term: "Queue = Broker + DB",
    description:
      "Split the system into a Broker for ephemeral dispatch and a DB for durable state — if the broker forgets, the DB still remembers.",
  },
  {
    id: "detect-death",
    eyebrow: "STEP 2",
    title: "The broker cannot see a heartbeat",
    term: "Visibility timeout",
    description:
      "A claimed job gets a time-boxed lease; if it is not acknowledged before the lease expires, the broker assumes the worker died and makes the job visible again.",
  },
  {
    id: "at-least-once",
    eyebrow: "STEP 3",
    title: "At-least-once delivery means duplicates",
    term: "At-least-once delivery",
    description:
      "A lease can expire on a worker that is only slow, not dead, so the same job gets delivered twice.",
  },
  {
    id: "race-idempotency",
    eyebrow: "STEP 4",
    title: "Two workers, one row, at the same time",
    term: "Race condition & Idempotency",
    description:
      "SELECT … FOR UPDATE inside a transaction serializes the read — it blocks the second worker until the first commits.",
  },
  {
    id: "retry",
    eyebrow: "STEP 5",
    title: "Sometimes nothing crashed — the API just failed",
    term: "Retry with Backoff + Jitter",
    description:
      "A worker can be perfectly alive and still fail — a rate-limit or timeout from an external API. Exponential backoff with jitter keeps workers from retrying in lockstep",
  },
];
