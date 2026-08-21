# AGENTS.md

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
