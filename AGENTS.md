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
- New non-trivial plans start in `awaiting-approval`. Stop after writing the plan
  and do not change application code until the human explicitly approves
  implementation. After approval, set the plan to `active` and record the approval
  in its progress log.
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
every file edit. After implementation and full verification, set the plan to
`awaiting-final-review` and stop for human review. Only after explicit final
approval may the agent update architecture/product status, set the plan to
`completed`, create the final local commit, and move the plan to `completed/`.

Execution-plan states are:

- `awaiting-approval`: planning is complete; implementation is blocked on human
  approval.
- `active`: implementation was approved and is in progress.
- `awaiting-final-review`: implementation and full verification are complete;
  archival is blocked on human approval.
- `completed`: final approval was received and the historical plan is archived.

Small local changes may skip a checked-in plan only when they do not alter public
behavior, schema, architecture, infrastructure, or more than one subsystem.
Completed plans are historical evidence and must not be edited to represent
current behavior.

### Commit messages

Use Conventional Commit-style subjects:

```text
<type>: <imperative summary>
```

Allowed types are `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, and `ci`.
Describe the intent of the checkpoint in the imperative mood, keep the subject
concise, and do not use vague messages such as `update files` or `work in
progress`. Add a body only when the reason, trade-off, or verification context
will help a future agent.

## Documentation freshness

- Behavior, schema, architecture, and operations changes include documentation
  updates in the same deliverable.
- Priority changes update the product-spec index, not completed plans.
- Plans record what happened in one task; do not write predictions as completed
  state.
- Only the source named in the diagram manifest may be edited. Regenerate outputs
  instead of modifying generated assets directly.

## Current verification commands

Run the repository-owned harness from the repository root:

- Fast feedback without a database or running Docker daemon:
  `./scripts/verify.sh quick`
- Complete verification with tests, builds, and Terraform validation:
  `./scripts/verify.sh full`

The harness bootstraps the Python virtual environment and frontend dependencies
when their committed manifests change. It requires Python 3.13, Node.js 22,
Terraform 1.5 or newer, and a Docker/Compose installation. Full verification
starts an isolated PostgreSQL container and removes it on exit, so do not point
it at the development database. CI uses the same full entry point with an
external service container.

## Code conventions

- Existing Traditional Chinese comments may remain. New comments should explain
  non-obvious intent, not restate code.
- Django/DRF tests follow the existing AAA structure.
- The database is authoritative for job state; Redis is a delivery mechanism.
- Prefer explicit boundaries, deterministic commands, and actionable failures
  that another agent can understand without chat history.
