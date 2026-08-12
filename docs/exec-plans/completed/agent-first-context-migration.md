# Agent-first context migration

- Status: completed
- Started: 2026-08-12
- Updated: 2026-08-12

## Context

Repository knowledge is currently split across a teaching-oriented `AGENTS.md`,
two long roadmaps, architecture notes, diagram sources, generated assets, and
diagram generators stored together under `docs/`. Agents cannot reliably tell
current behavior, future intent, and active execution state apart.

## Goal

Create a progressively disclosed repository knowledge system that separates
current state, product intent, and execution state, while assigning every
diagram source, generator, output, and consumer an explicit home.

## Acceptance criteria

- `AGENTS.md` is a short agent-first entry point with only valid links.
- Current architecture, product intent, and active/completed execution state
  have separate versioned locations.
- Every old roadmap item is represented by current-state documentation, a
  product spec, or an explicit decision not to retain it.
- Diagram sources, generators, rendered outputs, and frontend assets have
  documented ownership and no redundant README/frontend SVG copies.
- Markdown links and image paths resolve, and the frontend still builds.

## Out of scope

- Application behavior or architecture changes.
- A unified verification script, CI changes, machine-enforced architecture
  rules, metrics, and GitHub PR automation.

## Implementation plan

- [x] Inspect the existing documents, roadmaps, diagram references, and build
  scripts.
- [x] Replace the teaching contract with a concise repository map.
- [x] Establish current-state, product-spec, and execution-plan documents.
- [x] Migrate roadmap knowledge and remove the old roadmap files.
- [x] Rehome diagram sources, scripts, and outputs; update every consumer.
- [x] Validate links, generators, existing checks, and the frontend build.
- [x] Record the outcome and move this plan to `completed/`.

## Progress

- 2026-08-12: Repository inventory and existing verification baseline recorded.
- 2026-08-12: Migration structure agreed with the project owner.
- 2026-08-12: Replaced the teaching contract with a 74-line agent-first map.
- 2026-08-12: Migrated delivered facts and future work out of the two roadmaps,
  then removed the obsolete roadmap directory.
- 2026-08-12: Assigned diagram sources, generators, outputs, and consumers to
  explicit locations and removed duplicate README SVG copies.

## Decision log

- Product specs describe desired outcomes; architecture/current-state documents
  describe repository facts; execution plans describe work in progress.
- Frontend-imported Excalidraw scenes remain frontend source assets.
- Generated assets live with their consumer. README reuses frontend public SVGs
  instead of keeping duplicate copies.

## Discoveries and risks

- Backend tests require Postgres and do not currently self-provision it; solving
  that belongs to the later verification phase.
- The frontend build succeeds but reports Node-version and bundle-size warnings;
  these are not caused by this documentation migration.
- Several architecture image references point to files that do not exist. They
  will be replaced with links to owned, existing diagram outputs.

## Verification results

- Markdown relative-link check: 18 Markdown files checked, all targets resolve.
- `python3 -m py_compile tools/diagrams/*.py`: passed.
- Security-topology and deploy-pipeline generators rebuilt their derived pages
  from the relocated sources successfully.
- `python3 scripts/check_env_parity.py`: passed (15 required, 2 optional).
- `cd durable_queue && ../.venv/bin/python manage.py check`: passed.
- `npm --prefix frontend run lint`: passed with the two pre-existing Fast Refresh
  warnings recorded in the architecture/current-state documentation created by
  that migration (later consolidated into `docs/architecture.md`).
- `npm --prefix frontend run build`: passed; all nine public diagram SVGs were
  copied to `dist/diagrams/`. The pre-existing large-chunk warning remains.
- `git diff --check`: passed.

## Handoff

Migration is complete. The context layer was later simplified so `AGENTS.md` is
now the only repository entry point. The next ready product initiative is real
YouTube transcription in
`docs/product-specs/real-transcription.md`; create a new active execution plan
before changing application code.
