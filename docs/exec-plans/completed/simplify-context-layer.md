# Simplify context layer

- Status: completed
- Started: 2026-08-12
- Updated: 2026-08-12

## Context

The first context migration introduced two redundant navigation hops:
`AGENTS.md → docs/README.md` and separate current-state/architecture documents.
That structure is appropriate for a much larger knowledge base but adds context
cost without improving navigation in this repository.

## Goal and acceptance criteria

- Make `AGENTS.md` the only repository-level context entry point.
- Merge current facts and architecture into `docs/architecture.md`.
- Remove redundant docs and execution-plan indexes without losing their rules.
- Leave every Markdown link valid and keep the context flow understandable from
  `AGENTS.md` alone.

## Out of scope

- Product, application, diagram, CI, and verification behavior.

## Plan and progress

- [x] Move authority, workflow, and freshness rules into `AGENTS.md`.
- [x] Merge architecture and current-state documents.
- [x] Remove redundant indexes and repair references.
- [x] Validate links and archive this plan.

## Decisions

- Product-spec and diagram indexes remain because they own status and asset
  metadata; they are not general repository navigation layers.

## Verification

- Markdown relative-link check: 15 files checked, all targets resolve.
- Stale context-path scan: no obsolete entry-point references remain outside
  this plan's historical context.
- `git diff --check`: passed.
- `python3 scripts/check_env_parity.py`: passed (15 required, 2 optional).

## Handoff

`AGENTS.md` is now the only repository-level context entry point. The next
product task should read `docs/architecture.md`, the selected product spec, and
its own active execution plan—no general docs index is required.
