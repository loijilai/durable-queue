# Production observability

- Status: proposed

## Goal

Make production health and individual API-to-worker journeys inspectable through
structured logs, metrics, traces, dashboards, and actionable alerts.

## Requirements

- Metrics answer whether the system is healthy: queue depth, task latency,
  completion/failure rate, retry count, and dependency saturation.
- Traces correlate an HTTP request, database job, broker delivery, worker attempt,
  and external transcription call.
- Structured logs carry correlation fields and redact credentials/user content.
- SLOs and alerts are defined before choosing dashboard thresholds.

## Acceptance criteria

- An operator can identify whether a slow job is waiting in the queue, running in
  a worker, blocked on a dependency, retrying, or terminally failed.
- Dashboards and alert definitions are versioned in the repository.

## Non-goals

- Treating Flower as production observability.
- Choosing a vendor before signals and operational questions are specified.
