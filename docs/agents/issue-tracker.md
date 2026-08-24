# Issue tracker: local markdown

Issues and specs for this repo live as markdown files under `issues/`, tracked in git alongside the code.

## Layout

```
issues/
└── <feature-slug>/
    ├── spec.md
    ├── 01-<ticket-slug>.md
    └── 02-<ticket-slug>.md
```

One directory per feature. `spec.md` holds the spec; every other file in the directory is a ticket, numbered from `01`.

## Ticket fields

One line at the top of a ticket file:

```
Status: open
```

- `Status:` is `open` or `done`.

Dependencies are carried by the numbering, not by a field — see below.

## Operations

The skills name these operations; this file is what they mean here.

- **Publish a spec** — write `issues/<feature-slug>/spec.md`, creating the directory.
- **Publish a ticket** — write `issues/<feature-slug>/<NN>-<slug>.md` with its `Status: open` line. Number from `01` in dependency order, so a ticket's blockers always carry lower numbers than it does.
- **Fetch a ticket** — read the file. The user normally passes a path or a number; a bare number resolves inside the feature directory in play.
- **List open tickets** — the files in the feature directory whose `Status:` is `open`.
- **Next unblocked ticket** — the lowest-numbered open ticket. Because numbering follows dependency order, every ticket below it is `done`, and its blockers are all below it. This is the ticket to implement next.
- **Mark done** — set the ticket's `Status:` to `done`.

## Scope of this file

This file governs where issues live and how to operate on them. What goes *inside* a spec or a ticket belongs to the skills that write them.

## Using a different tracker

Replace the contents of this file with the conventions of whatever you use — GitHub through `gh`, GitLab through `glab`, Jira, or prose describing your workflow. The skills only ever name the operations above; this file is the translation layer, and it is the only place that changes.
