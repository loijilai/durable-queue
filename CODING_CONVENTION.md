## Code conventions

- Existing Traditional Chinese comments may remain. New comments should explain
  non-obvious intent, not restate code.
- Django/DRF tests follow the existing AAA structure.
- The database is authoritative for job state; Redis is a delivery mechanism.
- Prefer explicit boundaries, deterministic commands, and actionable failures
  that another agent can understand without chat history.
