# Kubernetes and SQS migration

- Status: proposed

## Goal

Move stateless API/worker orchestration to Kubernetes and evaluate SQS as the
durable broker while preserving PostgreSQL as the authoritative job-state store.

## Requirements

- Define pod, service, ingress, rollout, health, migration, and worker shutdown
  behavior before replacing the current ASGs.
- Compare SQS visibility timeout, redelivery, DLQ, ordering, and Celery support
  against the current Redis delivery model.
- Remove migrate-on-every-process-start and give schema migration one explicit,
  observable owner.
- Reassess RDS Multi-AZ, broker HA, autoscaling signals, and per-AZ egress as part
  of the target failure model.

## Acceptance criteria

- A future execution plan includes a migration/rollback path and proves that an
  accepted job survives worker and broker delivery failures covered by the spec.
- API and worker can scale independently without concurrent migration races.

## Non-goals

- Treating Kubernetes alone as a reliability improvement.
- Selecting exact cluster topology or managed services before the spec is refined.
