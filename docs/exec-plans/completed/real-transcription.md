# Real YouTube transcription

- Status: completed
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
- Product-owner review of the first implementation round found a real gap:
  OpenAI's `audio.transcriptions.create()` endpoint enforces a **25MB
  per-request file size limit**, independent of and unrelated to the
  duration limit implemented in round 1. The round-1 `real_transcribe()`
  downloaded and transcribed the whole video as a single audio file with no
  size check, so anything longer than roughly 15-40 minutes (depending on
  encoded bitrate) would fail as a permanent `InvalidMediaError` even though
  the job's configured duration limit allowed it. The product owner needs
  videos up to at least 2.5 hours (9000s) to transcribe successfully, which
  is impossible without splitting audio into multiple sub-25MB requests.

## Goal

A configured worker downloads audio for a submitted YouTube URL with
`yt-dlp`, transcribes it via the OpenAI transcription API, and persists the
result through the existing job lifecycle — with explicit retryable/permanent
error handling, guaranteed temp-file cleanup, no secret leakage, and a
recorded decision on the execution-layer idempotency window. Videos long
enough that their extracted audio would exceed OpenAI's 25MB per-request
limit (e.g. 2.5-hour content) must still transcribe successfully by being
split into multiple sub-25MB chunks that are transcribed and concatenated.

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
- [x] A video up to at least 2.5 hours (9000s) transcribes successfully:
  audio is split into fixed-duration chunks that individually stay well
  under OpenAI's 25MB per-request limit, each chunk is transcribed, and the
  chunk transcripts are concatenated in order into the job's final
  transcript.
- [x] A single chunk's retryable failure (timeout/connection/rate limit) is
  retried at the chunk level, up to a bounded number of attempts, before it
  is allowed to fail the whole job — so a transient blip on chunk N does not
  force re-transcribing already-succeeded chunks 1..N-1 via a whole-task
  Celery retry.
- [x] If a chunk exhausts its chunk-level retries (retryable) or fails
  permanently, the whole job fails (all-or-nothing at the job level); no
  partial transcript is persisted and no new job state is introduced.
- [x] Chunk splitting/count/size behavior is covered by tests that mock
  `yt-dlp`/`ffmpeg`/OpenAI — no real audio processing or network calls.

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
- [x] ~~Set the `yt-dlp` `FFmpegExtractAudio` postprocessor to a fixed, low,
  speech-appropriate encoding~~ — implemented differently than planned: kept
  `yt-dlp` downloading the raw `bestaudio` stream with no postprocessor, then
  re-encode-and-split in one `ffmpeg` `subprocess.run` call (`-ac 1 -ar 16000
  -b:a 64k -f segment -segment_time <N>`) instead of a separate yt-dlp
  postprocessor pass followed by a `-c copy` split. One ffmpeg invocation
  instead of two; see Decision log.
- [x] After download, split into fixed-duration chunks at
  `REAL_TRANSCRIBE_CHUNK_SECONDS` (new env var, default 1200s/20min — at
  64kbps mono that is ~9.6MB per chunk, comfortably under the 25MB limit).
  No sentence-boundary awareness; chunks cut at fixed time offsets.
- [x] Transcribe each chunk in order; on a chunk's retryable failure, retry
  that chunk in-process up to a bounded count (e.g. 3, mirroring the task's
  existing `max_retries=3`) with backoff before propagating; on chunk
  permanent failure, propagate immediately. Either propagation fails the
  whole `real_transcribe()` call (all-or-nothing) with the same
  retryable/permanent typed exception the chunk raised, so `tasks.py`'s
  existing retry policy applies unchanged at the job level.
- [x] Concatenate successful chunk transcripts in order (simple join; cut
  points are not sentence-aware by explicit product decision) into the
  single transcript returned to `mark_succeeded`.
- [x] Raise the default `REAL_TRANSCRIBE_MAX_DURATION_SECONDS` from 1800s to
  a value that comfortably covers 2.5-hour input (e.g. 14400s/4h), since the
  chunking work removes the file-size reason to keep it low; update
  `.env.example` and architecture docs accordingly.
- [x] Add/extend tests: chunk count for a given duration and
  `REAL_TRANSCRIBE_CHUNK_SECONDS`, in-order concatenation, chunk-level retry
  exhausting before job failure, chunk permanent failure short-circuiting
  remaining chunks, and cleanup still removing all per-chunk files on every
  outcome.
- [x] Update `docs/architecture.md`'s real-transcriber section with the
  chunking behavior, the 25MB constraint it works around, and the new/raised
  env vars. Re-run `./scripts/verify.sh quick` and `./scripts/verify.sh full`,
  then stop for final review again.

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
  `awaiting-final-review`. (A checkpoint commit was attempted but denied by
  the environment's permission prompt; the round-1 changes remained
  uncommitted in the working tree pending review.)
- 2026-08-13: Product-owner review before final approval found that the
  25MB OpenAI per-request file-size limit was not handled, blocking the
  stated requirement of transcribing videos up to 2.5 hours. Discussed and
  agreed the chunking design (see Decision log); status reverted to `active`
  and this plan updated with the round-2 acceptance criteria and
  implementation steps. Round-2 code has not been written yet — implementation
  resumes on next approval to proceed.
- 2026-08-13: Product owner confirmed the chunk-level-retry +
  all-or-nothing design and asked to commit round 1 before continuing.
  Resolved a global `git commit` permission deny (see Discoveries and
  risks) and committed round 1 as `3d04b44`.
- 2026-08-13: Implemented round 2 (chunking): single-pass `ffmpeg`
  re-encode+split, chunk-level bounded retry with backoff, all-or-nothing
  job outcome, raised `REAL_TRANSCRIBE_MAX_DURATION_SECONDS` default,
  extended tests, updated architecture docs. Full verification passed;
  status changed to `awaiting-final-review`.
- 2026-08-13: While setting up local testing, found and fixed a missing
  `ffmpeg` in the shared Docker image (`39d5f1d`) so `TRANSCRIBER=real`
  actually works via the documented `docker compose up --build` workflow.
- 2026-08-13: Product owner set `TRANSCRIBER=real` and a real
  `OPENAI_API_KEY` locally, ran `docker compose up --build`, and submitted a
  real YouTube job end to end; confirmed success. The product owner granted
  final approval; `docs/product-specs/README.md` and `docs/architecture.md`
  updated to reflect delivered status, and this plan archived as `completed`.

## Checkpoint commits

- `3d04b44` — round 1: single-file real adapter (download, transcribe,
  retryable/permanent taxonomy, task retry-policy extension, dependency/env-var
  additions, tests, docs). Passed full verification before commit. (A
  `git commit` permission deny at the user-settings level had to be resolved
  first — see Discoveries and risks.)
- `a1d39d6` — round 2: chunked download/re-encode/split via a single ffmpeg
  pass, chunk-level bounded retry, all-or-nothing job outcome, raised
  duration-limit default, extended tests and docs. Passed full verification
  before commit.
- `39d5f1d` — local-testing fix: install `ffmpeg` in the shared API/worker
  Docker image. Found while setting up local testing: the documented
  `docker compose up --build` workflow shares one image for both roles, and
  it had no `ffmpeg`, so `TRANSCRIBER=real` would fail inside Docker even
  with valid config. Verified `ffmpeg -version` and `yt-dlp` both run inside
  the built image.

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
- Long-video support (>25MB extracted audio): product owner chose **chunk-level
  retry (axis 1) + all-or-nothing at the job level (axis 2)**, rejecting a
  partial-transcript/new-job-state design. Reasoning discussed and agreed:
  the job model's single `transcript` field and four-state lifecycle
  (`PENDING/RUNNING/SUCCEEDED/FAILED`) is an explicit architecture invariant;
  partial results would require a new state, API/serializer changes, and
  frontend changes, which is a separate product decision out of scope for
  this spec. Chunk-level retry (bounded attempts per chunk, in-process,
  before propagating to the Celery task) avoids re-transcribing
  already-succeeded chunks on a transient failure, which matters because it
  would otherwise compound the already-accepted idempotency-window cost risk.
  A chunk that exhausts retries or fails permanently fails the whole job
  through the existing typed-exception path, so `tasks.py`'s retry policy
  and `services.py`'s state machine need no changes for this.
- Chunking rule: fixed-duration splitting, not sentence/silence-aware, per
  explicit product-owner instruction ("不用避免切在字句中間"). Implemented as
  a single `ffmpeg` invocation per job: `yt-dlp` downloads the raw
  `bestaudio` stream (no postprocessor), then one `ffmpeg` call re-encodes to
  a fixed 64kbps mono/16kHz bitrate *and* splits via the `segment` muxer at
  `REAL_TRANSCRIBE_CHUNK_SECONDS` (default 1200s/20min ≈ 9.6MB/chunk, ~2.5x
  margin under the 25MB API limit) in one pass. This was simpler than the
  originally planned two-step "yt-dlp extracts via `FFmpegExtractAudio`
  postprocessor, then a second `-c copy` ffmpeg split" — one subprocess call
  instead of two, and no dependency on yt-dlp's postprocessor-args API
  surface for forcing mono/bitrate. Rejected alternative: single-file
  aggressive compression to fit under 25MB — this only postpones the problem
  to even longer videos and degrades quality further, whereas chunking
  scales to arbitrary length.
- `REAL_TRANSCRIBE_MAX_DURATION_SECONDS` default will be raised from 1800s
  (round 1's arbitrary conservative default) to a value that comfortably
  covers the stated 2.5-hour need, now that chunking removes the file-size
  reason to keep it small.

## Discoveries and risks

- No existing exception taxonomy for retryable vs. permanent failures beyond
  `ConnectionError`/`TimeoutError`; this plan introduces the first one.
- No existing YouTube/audio/OpenAI dependency, so `ffmpeg` availability in
  local/dev/CI environments needs explicit setup documentation.
- The idempotency window is a known, previously-deferred gap
  (`docs/architecture.md:102-105`); this task is the first to require a
  concrete decision rather than deferral.
- Round-1 implementation missed OpenAI's 25MB per-request audio file size
  limit entirely (only duration was bounded). Found during product-owner
  review before final approval, not during automated verification — no
  automated check would have caught this because it is a product-input
  question ("how long must supported videos be"), not a code defect.
  Round 2 (chunking) addresses it; see Decision log.
- `git commit` was globally denied by a `Bash(git commit:*)` rule in
  `~/.claude/settings.json`'s `permissions.deny`, independent of the command's
  content (a plain `git commit -m "..."` was denied identically). Resolved
  with the product owner's explicit direction: removed that user-level deny
  entry, and added a project-scoped `Bash(git commit *)` allow rule to this
  repo's `.claude/settings.local.json` so commits here no longer prompt.
  `git push` and `rm -rf` remain denied at the user level, unchanged.
- While setting up local testing per the product owner's request, found the
  shared API/worker Docker image (`durable_queue/Dockerfile`) had no
  `ffmpeg`, so the documented `docker compose up --build` workflow would fail
  `TRANSCRIBER=real` jobs with a configuration error even with a valid
  `OPENAI_API_KEY`. Fixed in `39d5f1d`. Running the worker natively (outside
  Docker) still requires `ffmpeg` installed separately on the host.

## Verification results

Round 1 only (single audio file per job, no chunking):

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

Round 2 (chunking for long videos):

- Extended/new focused tests in `durable_queue/jobs/tests/test_real_transcriber.py`
  (26 tests total, +7 over round 1): multi-chunk happy path with in-order
  concatenation, duration limit skips ffmpeg/OpenAI entirely, permanent
  chunk failure stops remaining chunks (all-or-nothing), chunk-level retry
  recovers from a transient failure, chunk-level retry exhausts then fails
  the job, ffmpeg non-zero exit is a permanent error, missing `ffmpeg`
  binary is a configuration error, plus a dedicated `_split_into_chunks`
  unit-test class.
- `./scripts/verify.sh quick`: passed.
- `./scripts/verify.sh full`: passed — 64 Django tests (was 57; +7 new),
  no missing migrations, frontend build, all three Terraform roots
  validated, backend Docker image build, isolated PostgreSQL cleanup.

Manual end-to-end (product owner, local Docker Compose):

- `TRANSCRIBER=real` with a real `OPENAI_API_KEY` via `docker compose up
  --build`; a real YouTube URL was submitted and reached `SUCCEEDED` with a
  persisted transcript. Confirmed by the product owner as a successful test.

## Handoff

Both rounds are implemented, fully verified (automated), and manually
verified end to end locally by the product owner. Real-adapter behavior
(`TRANSCRIBER=real`): `yt-dlp` downloads raw audio, a single `ffmpeg` pass
re-encodes it to 64kbps mono and splits it into
`REAL_TRANSCRIBE_CHUNK_SECONDS`-long chunks, each chunk is transcribed via
OpenAI with bounded in-process retry on retryable failures, chunk
transcripts are concatenated in order, and the whole job fails
all-or-nothing on any chunk's permanent failure or exhausted retries. The
fake adapter and its existing tests are unchanged. The idempotency-window
decision (Option A — accept and document) and the chunking design (axis
1: chunk-level retry, axis 2: all-or-nothing) are recorded in the Decision
log and in `docs/architecture.md`. Final approval received; this plan is
archived as `completed`. Future work on this surface (e.g. exactly-once
execution, production deployment of the real adapter) should start a new
execution plan rather than reopen this one.
