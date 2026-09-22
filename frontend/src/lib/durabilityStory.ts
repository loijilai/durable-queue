export type StoryNodeId =
  | "crash"
  | "detect-death"
  | "transient-error"
  | "race-idempotency";

export interface StoryNode {
  id: StoryNodeId;
  eyebrow: string;
  title: string;
  term: string;
  description: string;
}

// Steps 1–3 are the three ways one execution can end — it succeeds, the Worker
// crashes, or a transient error sends it back to SQS — and together they are the
// durable design. Step 4 is the price of steps 2–3: both recover by redelivery, so
// the same Job can arrive twice. On-screen text is intentionally minimal (context
// sentence + key term); the rest is narrated live.
export const STORY_NODES: StoryNode[] = [
  {
    id: "crash",
    eyebrow: "STEP 1",
    title: "A worker can die mid-task",
    term: "Queue = Broker + DB",
    description: "",
  },
  {
    id: "detect-death",
    eyebrow: "STEP 2",
    title: "The broker cannot see a heartbeat",
    term: "Visibility timeout",
    description: "",
  },
  {
    id: "transient-error",
    eyebrow: "STEP 3",
    title: "An external API can fail for a moment",
    term: "Retry with Backoff + Jitter",
    description:
      "Base 30s, doubling, capped at 300s, equal jitter. After the 4th attempt the Job is marked failed.",
  },
  {
    id: "race-idempotency",
    eyebrow: "STEP 4",
    title: "SQS delivers at-least-once, so the same Job can arrive twice",
    term: "At-least-once delivery & Idempotency",
    description: "",
  },
];
