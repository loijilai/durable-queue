# Domain docs

How the engineering skills consume this repo's domain documentation while exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the project's glossary and mental model.
- **`docs/adr/`** — the ADRs covering the area you are about to work in.

When either is missing, proceed silently. They are written lazily, at the moment a term or a decision actually gets resolved; the `domain-modeling` skill creates them then.

## Use the glossary's vocabulary

When your output names a domain concept — an issue title, a hypothesis, a test name, a refactor proposal — use the term as `CONTEXT.md` defines it.

A concept the glossary does not carry is a signal: either you are inventing language the project does not use, or there is a real gap worth recording.

## Flag ADR conflicts

When your output contradicts an ADR, surface it:

> _Contradicts ADR-0007 (event-sourced orders) — worth reopening because…_
