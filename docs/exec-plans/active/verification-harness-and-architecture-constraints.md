# Verification harness and architecture constraints

- Status: active
- Started: 2026-08-12
- Updated: 2026-08-12

## Context

The repository has an agent-first context layer, but verification remains a list
of manually composed commands. Backend tests require a separately provisioned
PostgreSQL instance, CI does not run frontend or Terraform checks, and the
architecture rules in `docs/architecture.md` are not mechanically enforced.

## Goal

Provide one self-bootstrapping verification interface for fast and complete
feedback, make CI consume that same interface, and encode the current job-state
and repository-knowledge boundaries as actionable checks.

## Acceptance criteria

- [x] `./scripts/verify.sh quick` bootstraps dependencies and runs all checks that
  do not require a database or Docker daemon.
- [x] `./scripts/verify.sh full` provisions an isolated local PostgreSQL service,
  runs all application and infrastructure checks, builds the backend image, and
  cleans up on success or failure.
- [x] CI invokes the full harness while preserving the existing job IDs and
  deployment behavior.
- [x] Architecture and repository-contract violations fail with file, line,
  invariant, remediation, and rerun guidance.
- [x] The custom checkers have unit coverage for allowed and forbidden cases.
- [x] Frontend lint passes with zero warnings and generated TypeScript build info
  no longer dirties the worktree.
- [x] Agent, architecture, and startup documentation describe the current
  verification contract and enforced boundaries.

## Out of scope

- Metrics and historical throughput baselines.
- Real transcription, OAuth restructuring, product API changes, database schema
  changes, and deployment-pipeline redesign.
- Automatically installing system tools or starting a desktop Docker daemon.

## Implementation plan

- [x] Add dependency bootstrap, quick/full orchestration, and isolated PostgreSQL
  Compose support.
- [x] Add architecture and repository-contract checkers with unit tests.
- [x] Refactor frontend module boundaries and enforce zero lint warnings.
- [x] Route CI through the full harness while preserving existing job IDs.
- [x] Update repository documentation and run quick/full verification.
- [ ] Record checkpoint commits and archive this plan.

## Progress

- 2026-08-12: Repository baseline and implementation decisions were agreed with
  the project owner; metrics were explicitly deferred.
- 2026-08-12: Added a Bash 3.2-compatible quick/full harness, dependency hash
  stamps, Compose-command compatibility, isolated PostgreSQL lifecycle, and
  worktree-safe handling of TypeScript build metadata. Quick verification passes.
- 2026-08-12: Added AST dependency/lifecycle enforcement and repository knowledge
  checks with 12 focused tests; refactored Fast Refresh module boundaries and
  established zero-warning frontend lint.
- 2026-08-12: Routed the existing CI test job through full verification, updated
  current documentation, and verified both local-container and external-database
  full modes end to end.

## Checkpoint commits

- `915465e` — self-bootstrapping quick/full harness and isolated PostgreSQL lifecycle.

## Decision log

- Local full verification owns a temporary PostgreSQL container; CI uses its
  existing PostgreSQL service through an explicit external-database mode.
- The first constraint set protects current job lifecycle and dependency
  boundaries without restructuring OAuth or introducing a new application layer.
- Existing Fast Refresh warnings will be removed and future lint warnings fail
  verification.
- Dependency installation is automatic and keyed by the committed dependency
  manifests; system-tool installation remains outside the harness.

## Discoveries and risks

- The local Docker CLI currently has the legacy `docker-compose` plugin but its
  daemon is not running. Quick verification must remain usable in that state.
- Tracked TypeScript build-info files are generated output and must be removed
  from version control before build verification becomes worktree-safe.
- Running Django's default test discovery from the repository root discovered
  the 12 checker tests instead of the 36 `jobs` tests. The harness now names the
  `jobs` test label explicitly so its working directory cannot change coverage.

## Verification results

- Pre-change baseline: env parity, Django system check, frontend lint, and
  Terraform formatting pass; frontend lint reports two Fast Refresh warnings.
- Pre-change migration dry-run reports no changes but warns because PostgreSQL is
  unavailable.
- `./scripts/verify.sh quick`: passed after the first dependency bootstrap; the
  two known Fast Refresh warnings remain until the Phase 2 frontend cleanup.
- `./scripts/verify.sh quick`: passed with 12 checker tests and zero lint warnings
  after the Phase 2 cleanup.
- `./scripts/verify.sh full`: passed with 36 Django tests, no migration drift,
  frontend build, validation of all three Terraform roots, backend image build,
  and successful cleanup of the temporary database resources.
- External-database full mode: passed against a separately managed PostgreSQL 16
  container and left its lifecycle to the caller as intended for CI.
- CI workflow YAML parse: passed; the real GitHub-hosted run remains post-push
  evidence and is not available in this local-only task.

## Handoff

Implement the unified verification harness first, then checkpoint the verified
milestone before adding structural constraints and CI integration.
