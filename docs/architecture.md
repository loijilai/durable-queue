# Durable Queue architecture and current state

Status: current repository architecture. Future work is explicitly labeled and
lives under [`product-specs/`](product-specs/).

Last verified from the repository: 2026-08-13.

## Problem and guarantees

A client submits a YouTube URL and receives a job ID without waiting for the
long-running transcription. The system separates HTTP request handling from work
execution so accepted job state survives API and worker process failure.

Current guarantees:

- Job state is durable in PostgreSQL and exposed through the API.
- Celery/Redis delivery is at least once; duplicate delivery is expected.
- State transitions are serialized and terminal states are idempotent.
- A user can only query or retry their own jobs.

Not guaranteed today:

- Exactly-once execution of the external side effect.
- Durable broker storage through loss of the single Redis node.
- Multi-AZ availability for RDS, Redis, or NAT egress.

![Queue architecture](diagrams/rendered/1-queue-arch.png)

## Runtime components

| Component | Repository location | Responsibility |
| --- | --- | --- |
| Django API | `durable_queue/jobs/views.py`, `serializers.py` | Authenticate, validate input, expose owner-scoped jobs, dispatch tasks |
| Job services | `durable_queue/jobs/services.py` | Own transactional job-state transitions |
| Celery task | `durable_queue/jobs/tasks.py` | Coordinate delivery attempt, transcription, retry, and terminal result |
| Transcriber boundary | `durable_queue/jobs/transcribers.py` | Select fake or real transcription adapter |
| PostgreSQL | `TranscriptionJob` model | Authoritative job status, result, error, ownership, and attempts |
| Redis | Celery configuration | Broker and result backend; never authoritative job state |
| React SPA | `frontend/src/` | Authentication and interactive system-design demo |
| AWS infrastructure | `infra/` | Network, compute, stateful services, TLS/DNS, IAM, and deployment inputs |

The current backend has 64 Django tests covering API, authorization, OAuth,
serializer, service, task, real-transcriber chunking/error mapping/cleanup,
and PostgreSQL row-lock concurrency behavior. The
frontend contains the delivered authentication, queue, durability, HA,
scalability, and security demo surfaces.

## Verification and enforced boundaries

`./scripts/verify.sh` is the repository's verification contract. `quick` runs
all database-independent checks and is the default agent feedback loop. `full`
adds an isolated PostgreSQL service, Django tests and migration drift detection,
frontend and backend production builds, and validation of all three Terraform
roots. Dependency manifests are hash-stamped so a clean checkout bootstraps
itself while unchanged dependencies are reused.

The quick loop mechanically enforces these current invariants:

- Job lifecycle fields are mutated only by transactional operations in
  `jobs/services.py`.
- Models do not depend on higher job layers; services depend only on models;
  tasks use services and the transcriber boundary rather than models directly.
- Markdown links, product-spec indexing, execution-plan status/location, and
  declared diagram assets remain internally consistent.
- Application configuration, `.env.example`, and deployment inputs stay aligned.

Non-trivial execution plans use two human gates. A new plan remains
`awaiting-approval` until implementation is explicitly approved; after full
verification it becomes `awaiting-final-review` and remains under `active/`
until explicit final approval permits archival as `completed`.

Checker failures include the violated invariant, source location, remediation,
and the command to rerun. Tests and migrations are deliberately outside the
production architecture scan.

## Request and job data flow

1. An authenticated client calls `POST /api/jobs/` with a YouTube URL.
2. Django writes a `PENDING` job owned by the caller, dispatches
   `execute_job.delay(job_id)`, and returns the job representation.
3. A Celery worker receives the delivery and calls `mark_running()` inside a
   database transaction. The worker identity is appended to `worker_attempts`.
4. The configured transcriber runs. `TRANSCRIBER=fake` (the default) sleeps and
   returns fixed text. `TRANSCRIBER=real` downloads audio with `yt-dlp` and
   transcribes it through the OpenAI transcription API; it is a local opt-in
   path only — production infrastructure still deploys `TRANSCRIBER=fake`
   (`infra/compute.tf`).
5. The task writes `SUCCEEDED` plus transcript or, after exhausted retry/failure,
   `FAILED` plus error through the service boundary.
6. The SPA polls the owner-scoped API until it observes a terminal database state.

## State and concurrency boundaries

`TranscriptionJob` has four states: `PENDING`, `RUNNING`, `SUCCEEDED`, and
`FAILED`. Service functions use `transaction.atomic()` and
`select_for_update()` before checking and changing state.

The lock protects the read in check-then-act: a concurrent actor must observe the
committed status before deciding whether its transition is valid. A write lock by
itself would serialize updates but could still allow a decision based on stale data.

![Concurrent delivery race](diagrams/rendered/3-1-race-condition.png)

![Serialized state transitions](diagrams/rendered/4-sequence-concurrency.png)

At-least-once delivery leaves an execution-layer window: an external side effect
can complete before the database result is committed. For the fake adapter this
is harmless. For the real adapter (`TRANSCRIBER=real`) it is an accepted,
documented risk rather than a solved problem: a worker crash, or a
`CELERY_VISIBILITY_TIMEOUT` shorter than actual task duration, between a
successful `yt-dlp`/OpenAI call and the `mark_succeeded` commit can cause the
same job to be transcribed more than once, incurring duplicate OpenAI cost.
`mark_running`/`mark_succeeded`/`mark_failed` are no-ops once a job reaches a
terminal state, so the database always converges to one consistent final
result even if the external call ran twice — only external cost, not data
correctness, is at risk. No claim/lease/lock mechanism exists to close this
window; `worker_attempts` (recorded per delivery attempt) is the
observability signal — a job with more than one attempt that still reaches
`SUCCEEDED` indicates the window was hit.

![Duplicate delivery window](diagrams/rendered/3-worker-stuck-duplicate.png)

## Authentication boundary

- Django issues JWT access and refresh tokens for local login and after Google
  OAuth identity verification.
- DRF defaults to `IsAuthenticated`.
- Job querysets are filtered by `request.user`; a job owned by someone else is
  returned as 404 rather than disclosing its existence.
- The SPA sends the access token in the `Authorization` header. Tokens are not
  cookie-based in the current demo. Access and refresh tokens live in
  `sessionStorage`, so same-origin JavaScript can read them if an XSS bug exists.

![Google OAuth sequence](diagrams/rendered/auth-sequence-google-oidc.png)

## Deployment topology

The deployed design uses one container image for two stateless roles: an API ASG
behind an ALB and a worker ASG consuming Redis deliveries. Both span two subnets/AZs
and scale independently. RDS PostgreSQL and ElastiCache Redis provide shared state.

![AWS infrastructure](../frontend/public/diagrams/aws-infra.svg)

Network/security boundaries:

- Internet traffic terminates TLS at the public ALB.
- API and worker instances live in private subnets.
- Security groups reference other security groups along ALB → compute → stateful
  service paths; route tables independently provide reachability.
- Private egress goes through one NAT gateway. Internet hosts cannot initiate a
  connection through that NAT.
- Runtime secrets are fetched from Secrets Manager by an instance role. GitHub
  Actions receives short-lived AWS credentials through OIDC.
- DNS/bootstrap resources have separate Terraform state because their lifecycle
  must outlive routine application infrastructure replacement.

## Availability and scaling status

The API and worker compute tiers are replaceable and distributed across two AZs.
The API ASG uses ALB health rather than VM existence alone. This does not make the
whole system highly available: RDS is single-AZ, Redis is single-node, and all
private egress shares one NAT gateway.

The queue decouples API and worker scaling signals, but linear worker scaling is
bounded by PostgreSQL, Redis, and the future external transcription API.

![Independent worker scaling](diagrams/rendered/5-scale-out.png)

## Real transcriber (local opt-in)

`TRANSCRIBER=real` swaps the fake adapter for `yt-dlp` audio download +
OpenAI transcription (`durable_queue/jobs/transcribers.py`). It is opt-in for
local development only; the fake adapter remains the default everywhere,
including production (`infra/compute.tf`).

- **Opt-in workflow**: set `TRANSCRIBER=real` and `OPENAI_API_KEY` in `.env`
  (see `durable_queue/.env.example`). `ffmpeg` must be on `PATH` — it is
  baked into the shared API/worker image (`durable_queue/Dockerfile`) for
  `docker compose up`, and must be installed separately (e.g. Homebrew) when
  running the worker natively outside Docker. `fake`-mode Django/Celery
  processes never need `OPENAI_API_KEY` set; it is only read, and only
  required, when a job actually runs through the real adapter.
- **Chunking**: OpenAI's `audio.transcriptions.create()` enforces a 25MB
  per-request file size limit, independent of duration. To transcribe videos
  of any practical length (the product requirement is at least 2.5 hours),
  the downloaded audio is re-encoded to a fixed 64kbps mono bitrate and split
  by ffmpeg's `segment` muxer into fixed-duration chunks
  (`REAL_TRANSCRIBE_CHUNK_SECONDS`, default 1200s/20min ≈ 9.6MB/chunk — about
  2.5x margin under the 25MB limit). Splits are not sentence-aware, by
  explicit product decision. Each chunk is transcribed independently and the
  chunk transcripts are concatenated in order into the job's final
  transcript.
- **Chunk-level retry, all-or-nothing at the job level**: a chunk's retryable
  failure (timeout/connection/rate limit) is retried in-process up to
  `CHUNK_MAX_ATTEMPTS` (3, mirroring `execute_job`'s `max_retries=3`) with
  exponential backoff before it is allowed to fail the whole job. This
  matters because otherwise a transient blip on chunk N would trigger a
  whole-task Celery retry that re-transcribes (and re-bills) already
  succeeded chunks 1..N-1, compounding the idempotency-window risk below. If
  a chunk exhausts its retries, or fails permanently (invalid media), the
  whole job fails — no partial transcript is persisted and no new job state
  was introduced; the existing single-`transcript`-field, four-state job
  model is unchanged.
- **Cost**: each job makes one billable OpenAI transcription call per audio
  chunk per successful (or successfully-retried) attempt; pricing is set by
  OpenAI, not this repository. The accepted idempotency-window risk below
  means a job can occasionally be billed more than once.
- **Input limits**: `REAL_TRANSCRIBE_MAX_DURATION_SECONDS` (default 14400s/4hr)
  rejects videos longer than the configured limit as a permanent
  `PermanentInputError` before any chunking or OpenAI call, so oversized
  input never retries or incurs API cost. Chunking (above) is what makes long
  videos below this limit actually transcribable, rather than the duration
  limit itself.
- **Timeout behavior**: `REAL_TRANSCRIBE_TIMEOUT_SECONDS` (default 120s)
  bounds the `yt-dlp` socket timeout and each chunk's OpenAI call timeout.
  Timeouts, connection failures, and rate limiting (`TranscriptionRetryableError`
  and subclasses) are retried at the chunk level first (above), then by the
  same Celery policy as `ConnectionError`/`TimeoutError` (`max_retries=3`,
  exponential backoff with jitter) if a chunk still fails. Invalid media,
  permanent input failure, and misconfigured/rejected credentials
  (`TranscriptionPermanentError` and subclasses, including
  `TranscriptionConfigurationError`) fail the job immediately without
  consuming a retry.
- **Secrets and cleanup**: `OPENAI_API_KEY` is never logged or included in
  raised error messages. Downloaded audio and all its chunks live in a
  per-job temporary directory that is removed on every exit path (success,
  retryable failure, permanent failure).

## Known implementation gaps

- `real_transcribe()` is a local opt-in path (`TRANSCRIBER=real`); production
  infrastructure still deploys the fake adapter. The execution-layer
  duplicate-delivery window is an accepted, documented risk rather than a
  solved problem (see "State and concurrency boundaries" above).
- Redis is single-node, RDS has `multi_az = false`, and egress uses one NAT. The
  complete system does not provide stateful-tier or egress HA.
- API and worker startup both run migrations, which can race during rollout.
- Production structured logging, metrics, tracing, SLOs, and alerts do not exist;
  Flower provides development-time Celery visibility only.
- Worker scaling has no measured capacity envelope or backpressure policy for
  PostgreSQL, Redis, or the future external transcription API.
- The frontend build succeeds with a large-chunk warning. Lint has a zero-warning
  policy; the bundle warning remains a separate performance concern.

## Planned changes

Planned work is intentionally not described as current architecture. See:

- [Real transcription](product-specs/real-transcription.md)
- [Kubernetes and SQS](product-specs/kubernetes-sqs.md)
- [Production observability](product-specs/production-observability.md)
