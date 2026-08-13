# Product specs

Product specs describe desired outcomes and acceptance criteria. They do not
prove implementation. Delivery status becomes `delivered` only after code/tests
and the current architecture document agree.

## Status definitions

- `proposed`: intent is preserved but scope or priority still needs human review.
- `ready`: intent and minimum acceptance criteria are sufficient to create an
  execution plan.
- `active`: an implementation plan exists under `docs/exec-plans/active/`.
- `delivered`: current code and tests implement the spec.

## Initiative index

| Status | Initiative | Source |
| --- | --- | --- |
| delivered | Real YouTube transcription | [`real-transcription.md`](real-transcription.md) |
| proposed | Kubernetes and SQS migration | [`kubernetes-sqs.md`](kubernetes-sqs.md) |
| proposed | Production observability | [`production-observability.md`](production-observability.md) |
| delivered | Durable Celery/Postgres job lifecycle | [`../architecture.md`](../architecture.md) |
| delivered | JWT, Google OAuth, and owner isolation | [`../architecture.md`](../architecture.md) |
| delivered | React system-design demo | [`../architecture.md`](../architecture.md) |
| delivered | AWS v1 and OIDC CI/CD | [`../architecture.md`](../architecture.md) |

Priority is expressed by a human changing this index, not by the age or ordering
of a historical roadmap. The real-transcription spec was the first product
task selected after the agent-first context phase, and is now `delivered`:
`docs/architecture.md`'s "Real transcriber (local opt-in)" section and
`durable_queue/jobs/transcribers.py` implement it, and the product owner
verified a real job locally end to end.

## Roadmap migration ledger

| Old roadmap content | New authority |
| --- | --- |
| Completed DB queue, Celery, Postgres, API, auth, Docker, AWS, CI/CD, and frontend work | `architecture.md` |
| Real `yt-dlp` + OpenAI transcription | `real-transcription.md` |
| K8s, SQS, stateful HA, and migration-on-boot | `kubernetes-sqs.md` |
| Metrics, tracing, logging, dashboards, and alerts | `production-observability.md` |
| Backend interview-learning curriculum and completed tutorial steps | Intentionally retired; durable conclusions remain in current architecture and Git retains history |
