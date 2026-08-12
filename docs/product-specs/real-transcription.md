# Real YouTube transcription

- Status: ready
- Owner: product owner

## Goal

Replace the placeholder real adapter with an opt-in path that obtains audio from
a submitted YouTube URL, sends it to the OpenAI transcription API, and stores the
result through the existing durable job lifecycle.

## Requirements

- Keep the fake adapter available for deterministic local development and tests.
- Treat external timeout, connection failure, rate limiting, invalid media, and
  permanent input failure explicitly rather than retrying every exception.
- Keep API credentials and downloaded media out of Git and logs, and clean up
  temporary files on every outcome.
- Re-evaluate the execution-layer idempotency window before declaring the real
  adapter production-safe.
- Document cost, input limits, timeout behavior, and the local opt-in workflow.

## Acceptance criteria

- A configured worker can complete a valid real transcription and persist text.
- Retryable and permanent failures produce the intended Celery/job-state behavior.
- Automated tests do not call YouTube or OpenAI and cover cleanup and error mapping.
- Missing configuration fails with an actionable message and secret values never
  appear in output.

## Non-goals

- Exactly-once external execution without an explicit design decision.
- Production autoscaling, global rate-limit coordination, or a new user-facing UI.
