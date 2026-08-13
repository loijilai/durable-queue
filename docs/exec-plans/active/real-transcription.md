# Real YouTube transcription

- Status: awaiting-final-review
- Started: 2026-08-13
- Updated: 2026-08-13

## Context

`docs/product-specs/real-transcription.md` (status `ready`) asks for the
placeholder real adapter to be replaced with a working YouTube-to-OpenAI
transcription path, opt-in alongside the existing fake adapter.

Current state, confirmed by reading the source:

- `durable_queue/jobs/transcribers.py` — `real_transcribe()` is a
  `raise NotImplementedError` stub. `get_transcriber()` selects between
  `fake`/`real` via the required `TRANSCRIBER` env var (dict lookup, fails
  fast if unset/invalid). `fake_transcribe()` just sleeps and returns a fixed
  string, and must keep working for local dev and tests.
- `durable_queue/jobs/tasks.py` — `execute_job` only distinguishes retryable
  exceptions via `autoretry_for=(ConnectionError, TimeoutError)`,
  `max_retries=3`, `retry_backoff=True`, `retry_jitter=True`. Anything else
  falls straight through `ExecuteJobTask.on_failure` to `mark_failed`. There
  is no existing distinction for rate-limiting vs. permanent input failure —
  this plan must extend that taxonomy.
- `durable_queue/jobs/services.py` — `mark_running`/`mark_succeeded`/
  `mark_failed`/`retry_job` are the only state transitions, each guarded by
  `select_for_update()` inside `transaction.atomic()` and idempotent against
  terminal states.
- `docs/architecture.md:102-105` already names the gap this spec must close:
  "At-least-once delivery leaves an execution-layer window: an external side
  effect can complete before the database result is committed. This is
  accepted for the fake adapter and must be revisited by the
  real-transcription product spec." No idempotency key exists today; dedup
  relies solely on the state guard in `services.py`.
- Secrets today are all required `os.environ[...]` reads in `settings.py`
  (fail fast, no default) with `.env.example` as the documented source of
  truth. No YouTube/audio/OpenAI code or dependency exists yet.
  `requirements.txt` has `requests`/`google-auth` but no `openai` or
  `yt-dlp`. The Google OAuth exchange in `jobs/views.py:153-165` is the only
  existing template for mapping external HTTP errors to retryable vs.
  permanent outcomes.
- `docs/product-specs/README.md`'s roadmap ledger names the intended
  libraries explicitly: "Real `yt-dlp` + OpenAI transcription."

## Goal

A configured worker downloads audio for a submitted YouTube URL with
`yt-dlp`, transcribes it via the OpenAI transcription API, and persists the
result through the existing job lifecycle — with explicit retryable/permanent
error handling, guaranteed temp-file cleanup, no secret leakage, and a
recorded decision on the execution-layer idempotency window.

## Acceptance criteria

- [x] `TRANSCRIBER=real` with valid config downloads audio, calls OpenAI, and
  a job reaches `SUCCEEDED` with the transcript persisted.
- [x] Distinct exception types/branches exist for timeout, connection
  failure, rate limiting, invalid media, and permanent input failure; the
  first three are retried per Celery policy, the last two go straight to
  `mark_failed` without wasted retries.
- [x] Temporary downloaded-audio files are removed on every outcome (success,
  retryable failure, permanent failure, worker crash-safe via a
  try/finally-style guarantee), verified by a test that asserts no leftover
  files after each path.
- [x] Automated tests mock `yt-dlp` and the OpenAI client entirely — no
  network calls to YouTube or OpenAI in CI.
- [x] Missing/invalid `OPENAI_API_KEY` (and other real-adapter-only config)
  fails fast at task start — only when `TRANSCRIBER=real` and a job actually
  runs — with an actionable message, and no test or log assertion ever
  contains a real or placeholder secret value. `TRANSCRIBER=fake` and plain
  `manage.py`/Django startup never require `OPENAI_API_KEY` to be set.
- [x] `fake_transcribe`/`TRANSCRIBER=fake` behavior and existing tests are
  unchanged.
- [x] `docs/architecture.md` records the re-evaluated idempotency-window
  decision for the real adapter (accepted risk, per Decision log) instead of
  the current "must be revisited" note.
- [x] Cost, input limits (e.g. max video duration/file size), timeout
  behavior, and the local opt-in workflow (`TRANSCRIBER=real` + required env
  vars) are documented.

## Out of scope

- Exactly-once external execution guarantees beyond the documented decision.
- Production autoscaling or global rate-limit coordination across workers.
- Any new user-facing UI; the API/job contract is unchanged.
- Support for non-YouTube sources or batch/playlist input.

## Implementation plan

- [x] Add `yt-dlp` and an OpenAI client dependency to
  `durable_queue/requirements.txt`; document the `ffmpeg` system binary
  dependency (required by `yt-dlp` audio extraction) in README/architecture.
- [x] Add required config (`OPENAI_API_KEY`, transcription model, input
  duration/size limit, external call timeouts). Unlike `settings.py`'s
  unconditional `os.environ[...]` reads, `OPENAI_API_KEY` must only be
  required when the real adapter actually runs: read it lazily inside
  `real_transcribe()`/its adapter init (not at Django startup/`settings.py`
  import), so `TRANSCRIBER=fake` workers and the Django process never need it
  set. Missing it at real-transcribe time must fail the job with an
  actionable, secret-free error message. Document it in
  `durable_queue/.env.example` as required only for `TRANSCRIBER=real`.
- [x] Define an explicit exception taxonomy (e.g. a small set of adapter-level
  exception classes or a mapping function) distinguishing timeout, connection
  failure, rate limiting, invalid media, and permanent input failure, so
  `tasks.py` can branch on type rather than on ad hoc string checks.
- [x] Implement `real_transcribe()`: download audio to a per-job temp
  directory, enforce the input duration/size limit before calling OpenAI,
  call the OpenAI transcription API with a timeout, return the transcript,
  and guarantee temp-file/directory cleanup on every exit path (success,
  each error branch, and unexpected exceptions).
- [x] Extend `tasks.py`'s retry policy so rate-limit/timeout/connection
  failures retry (via `autoretry_for` or explicit `self.retry`) while invalid
  media and permanent input failures go directly to `on_failure` /
  `mark_failed` with a clear stored error message.
- [x] Document the accepted idempotency-window risk (decision: Option A, see
  Decision log) in `docs/architecture.md`, replacing the current "must be
  revisited" note with the concrete accepted-risk statement and the
  `worker_attempts`-based observability note. No code-level mitigation is
  implemented for this task.
- [x] Add unit tests that mock `yt-dlp` and the OpenAI client: happy path,
  each retryable/permanent error branch, cleanup-on-every-outcome, and
  missing-config fail-fast without secret leakage in raised messages/logs.
- [x] Update `docs/architecture.md` (idempotency-window note and real-adapter
  description) and add a short doc section covering cost, input limits,
  timeout behavior, and the local `TRANSCRIBER=real` opt-in workflow.
- [x] Run `./scripts/verify.sh quick` and `./scripts/verify.sh full`, fix any
  failures, then stop for final review.

## Progress

- 2026-08-13: Drafted this plan from the product spec and current repository
  state; awaiting product-owner approval to begin implementation.
- 2026-08-13: Product owner requested `OPENAI_API_KEY` be required only for
  the real adapter path (not Django/`settings.py` startup) and explicitly
  chose Option A (accept and document) for the idempotency-window decision;
  plan updated accordingly.
- 2026-08-13: Product owner explicitly approved implementation; status
  changed to `active`.
- 2026-08-13: Implemented the real adapter, retryable/permanent exception
  taxonomy, task retry-policy extension, dependency/env-var additions, tests,
  and documentation. Full verification passed; status changed to
  `awaiting-final-review`.

## Checkpoint commits

- `<sha>` — verified milestone represented by this commit.

## Decision log

- `OPENAI_API_KEY` is read lazily inside the real adapter, not eagerly in
  `settings.py` like other required env vars, so it is only mandatory when
  `TRANSCRIBER=real` and a job is actually executed. Product owner requested
  this explicitly.
- Idempotency-window mitigation approach: **Option A — accept and document**.
  No claim/lease/lock mechanism is added. Product owner explicitly accepted
  this as a known risk: at-least-once delivery means a worker crash (or a
  `CELERY_VISIBILITY_TIMEOUT` shorter than actual task duration) between a
  successful external call and the `mark_succeeded` commit can cause the real
  adapter to be invoked more than once for the same job, incurring duplicate
  OpenAI cost. `mark_running`/`mark_succeeded`/`mark_failed` remain no-ops
  once a job reaches a terminal state, so the database always converges to
  one consistent final result even if the external call ran twice — only the
  external cost, not data correctness, is at risk. `worker_attempts`
  (already recorded per attempt) is the observability signal: a job with
  more than one attempt that still reaches `SUCCEEDED` indicates the window
  was hit, and is a natural future alerting hook (out of scope here). This
  decision is documented in `docs/architecture.md` in place of the prior
  "must be revisited" note.
- OpenAI client integration style: used the official `openai` SDK (`openai==3.0.0`)
  rather than raw `requests` calls, because it provides typed exception classes
  (`RateLimitError`, `APITimeoutError`, `APIConnectionError`, `BadRequestError`,
  `AuthenticationError`, etc.) that map directly onto the retryable/permanent
  taxonomy this task needed, instead of parsing HTTP status codes by hand as the
  OAuth `requests` call does.
- `yt-dlp` failures mostly surface as one `DownloadError` with a free-text
  message rather than distinct exception types, so `_classify_download_error()`
  uses keyword matching (timeout/connection/rate-limit markers) and defaults
  unrecognized messages to permanent (`InvalidMediaError`) — an unclassified
  yt-dlp failure is far more often broken/unsupported input than transient
  infrastructure trouble, and retrying it would just burn Celery's retry budget.
- The input-duration limit (`REAL_TRANSCRIBE_MAX_DURATION_SECONDS`) is checked
  after download, using metadata `yt-dlp` already returns from
  `extract_info(download=True)`, rather than a separate pre-flight duration
  probe or a file-size limit — simpler, and duration is the more meaningful
  cost proxy for OpenAI's per-minute transcription pricing.
- `OPENAI_API_KEY` and friends are read with `os.environ.get(...)` (not
  `os.environ[...]`) so `scripts/check_env_parity.py` classifies them as
  optional: they only need to appear in `.env.example`, not in
  `infra/user_data.sh.tftpl`. This matches production reality — `infra/compute.tf`
  hardcodes `TRANSCRIBER=fake`, so the real adapter's config was never meant to
  be deployed, and adding Terraform/Secrets Manager wiring for it is out of
  scope for this local opt-in task.

## Discoveries and risks

- No existing exception taxonomy for retryable vs. permanent failures beyond
  `ConnectionError`/`TimeoutError`; this plan introduces the first one.
- No existing YouTube/audio/OpenAI dependency, so `ffmpeg` availability in
  local/dev/CI environments needs explicit setup documentation.
- The idempotency window is a known, previously-deferred gap
  (`docs/architecture.md:102-105`); this task is the first to require a
  concrete decision rather than deferral.

## Verification results

- New focused tests: `durable_queue/jobs/tests/test_real_transcriber.py` (19
  tests: happy path, temp-dir cleanup on success/failure, duration-limit
  rejection, `yt-dlp` error-message classification, full OpenAI exception
  mapping, missing-config fail-fast, secret-non-leakage, `get_transcriber`
  selection) plus 2 new cases in `test_task.py` (retryable vs. permanent
  transcription errors at the Celery task layer).
- `./scripts/verify.sh quick`: passed (env parity, 16 checker tests,
  architecture boundaries, repo contract, Django system check, frontend lint,
  Terraform fmt, diff whitespace).
- `./scripts/verify.sh full`: passed — 57 Django tests (was 36; +19 new
  transcriber tests, +2 new task tests), no missing migrations, frontend
  build, all three Terraform roots validated, backend Docker image build,
  isolated PostgreSQL cleanup.

## Handoff

Implementation and full verification are complete. Real-adapter behavior
(`TRANSCRIBER=real`): downloads audio via `yt-dlp`, transcribes via OpenAI,
classifies failures into retryable (`TranscriptionRetryableError` and
subclasses: timeout/connection/rate-limit) vs. permanent
(`TranscriptionPermanentError` and subclasses: invalid media/permanent
input/configuration), and always cleans up its temp directory. The fake
adapter and its existing tests are unchanged. The idempotency-window decision
(Option A — accept and document) is recorded in the Decision log and in
`docs/architecture.md`. Awaiting explicit final product-owner approval before
moving this plan to `completed/`.
