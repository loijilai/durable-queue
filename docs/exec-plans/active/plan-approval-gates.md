# Plan approval gates

- Status: active
- Started: 2026-08-13
- Updated: 2026-08-13

## Context

Execution plans currently distinguish only active and completed work. The desired
workflow requires an agent to stop after planning and again after full verification
so the product owner can approve implementation and completion separately.

## Goal

Add the smallest enforceable execution-plan lifecycle that preserves both human
approval gates.

## Acceptance criteria

- [x] Plans support `awaiting-approval`, `active`, `awaiting-final-review`, and
  `completed` statuses.
- [x] Repository instructions require agents to stop at both approval gates.
- [x] The repository checker accepts review states only in `active/` and accepts
  `completed` only in `completed/`.
- [x] Checker tests cover every allowed state and invalid directory/status pairs.
- [x] Quick and full verification pass before final review.

## Out of scope

- Automated approval identities, timestamps, signatures, or GitHub review integration.
- Additional draft or approved states.

## Implementation plan

- [x] Document the lifecycle and stop conditions in `AGENTS.md`.
- [x] Update the execution-plan template with the initial review state.
- [x] Extend the repository contract checker and its tests.
- [x] Run quick and full verification, then pause for final review.

## Progress

- 2026-08-13: The product owner explicitly approved implementing the minimal
  approval-gate workflow.
- 2026-08-13: Added the four-state lifecycle, both mandatory stop conditions,
  machine-enforced directory rules, and focused checker coverage.

## Checkpoint commits

- None yet.

## Decision log

- Keep all non-completed states in `active/`; directory moves happen only after
  final approval.
- Treat explicit approval in the current conversation as sufficient authorization
  to change a plan from `awaiting-approval` to `active`.

## Discoveries and risks

- The checker validates valid status placement but cannot prove that a human
  actually granted approval; explicit approval remains conversational evidence
  recorded in the plan progress log.

## Verification results

- Focused repository-contract tests: 8 passed.
- `./scripts/verify.sh quick`: passed with all 16 checker tests.
- `./scripts/verify.sh full`: passed with 16 checker tests, 36 Django tests,
  migration drift detection, frontend build, three Terraform validations,
  backend image build, and isolated PostgreSQL cleanup.

## Handoff

Implement the lifecycle, verify it, and stop at `awaiting-final-review`.
