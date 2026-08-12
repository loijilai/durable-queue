# AGENTS.md

## Mission

Durable Queue is an agent-first codebase. Humans define intent, priorities,
risk tolerance, and acceptance criteria. Agents own implementation, tests,
documentation, verification, and routine maintenance.

Optimize for reliable outcomes and future-agent legibility. When an agent gets
stuck or repeats a mistake, improve repository context, tools, or guardrails
instead of adding one-off chat instructions.

## Working contract

- Use the repository map below to read only the task-relevant sources before
  editing.
- For non-trivial work, create or resume an execution plan under
  `docs/exec-plans/active/` and keep its progress, decisions, discoveries, and
  verification results current.
- Make reasonable assumptions and execute end to end. Ask only when a decision
  is irreversible, externally consequential, or changes product intent.
- Keep changes scoped and leave the worktree in a verifiable state.
- During non-trivial work, create local checkpoint commits after coherent,
  verified milestones so progress survives session boundaries. Before committing,
  inspect the staged diff and include only files owned by the current task; never
  absorb unrelated user changes. Use an intent-focused commit message and record
  the commit SHA in the active execution plan.
- Add or update tests with behavior changes. Run the narrowest relevant checks,
  then the broader validation available for the touched area.
- Update `docs/architecture.md` when behavior, guarantees, or operational
  decisions change. Git is history; do not preserve stale claims.
- Never expose secrets. Do not deploy, merge, delete infrastructure, or perform
  other externally destructive actions without explicit authorization.
- Local checkpoint commits are authorized by default. Pushing, opening or updating
  a pull request, merging, and deploying still require explicit authorization.
- Treat failure as harness feedback: record the missing capability and prefer a
  reusable repository improvement over a one-off workaround.

## Repository map

- Product overview and local startup: [`README.md`](README.md)
- Current implementation and architecture: [`docs/architecture.md`](docs/architecture.md)
- Product intent and candidate initiatives: [`docs/product-specs/README.md`](docs/product-specs/README.md)
- Execution-plan template: [`docs/exec-plans/TEMPLATE.md`](docs/exec-plans/TEMPLATE.md)
- Active execution state: `docs/exec-plans/active/`
- Completed execution history: `docs/exec-plans/completed/`
- Diagram ownership and generation: [`docs/diagrams/README.md`](docs/diagrams/README.md)
- Frontend visual design system: [`DESIGN.md`](DESIGN.md)
- Backend application: `durable_queue/`
- Frontend application: `frontend/`
- AWS infrastructure: `infra/`
- CI/CD: `.github/workflows/ci-cd.yml`

Read only the documents relevant to the task. This file is a map, not an
encyclopedia.

## Context authority and workflow

When information conflicts, use this order and fix the lower authority in the
same change:

1. Human-approved intent and acceptance criteria for the current task.
2. Executable code, tests, configuration, migrations, and Terraform.
3. `docs/architecture.md` for current facts and system boundaries.
4. Product specs for desired outcomes; a spec does not prove implementation.
5. Active execution plans for work-in-progress decisions and status.
6. README files, completed plans, historical prose, and comments.

For non-trivial work, read the relevant architecture and product spec, then copy
the execution-plan template into `active/`. Keep progress, decisions,
discoveries, verification, and handoff notes current so another agent can resume
without chat history. Commit at coherent verified milestones rather than after
every file edit. On completion, update architecture/product status first, create
the final local commit, then move the plan to `completed/` as part of that commit.

Small local changes may skip a checked-in plan only when they do not alter public
behavior, schema, architecture, infrastructure, or more than one subsystem.
Completed plans are historical evidence and must not be edited to represent
current behavior.

## Documentation freshness

- Behavior, schema, architecture, and operations changes include documentation
  updates in the same deliverable.
- Priority changes update the product-spec index, not completed plans.
- Plans record what happened in one task; do not write predictions as completed
  state.
- Only the source named in the diagram manifest may be edited. Regenerate outputs
  instead of modifying generated assets directly.

## Current verification commands

Run commands from the repository root unless noted otherwise.

- Environment contract: `python3 scripts/check_env_parity.py`
- Django static check: `cd durable_queue && ../.venv/bin/python manage.py check`
- Django tests: `cd durable_queue && ../.venv/bin/python manage.py test`
- Frontend lint: `npm --prefix frontend run lint`
- Frontend production build: `npm --prefix frontend run build`
- Terraform formatting: `terraform -chdir=infra fmt -check -recursive`
- Terraform validation: `terraform -chdir=infra validate`

Backend tests require Postgres and environment variables. Until a unified
verification harness exists, use `durable_queue/.env` and the services in
`durable_queue/docker-compose.yml`; local Compose command spelling may be
`docker compose` or `docker-compose`.

## Code conventions

- Existing Traditional Chinese comments may remain. New comments should explain
  non-obvious intent, not restate code.
- Django/DRF tests follow the existing AAA structure.
- The database is authoritative for job state; Redis is a delivery mechanism.
- Prefer explicit boundaries, deterministic commands, and actionable failures
  that another agent can understand without chat history.
