#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-quick}"
VENV_DIR="$ROOT_DIR/.venv"
REQUIREMENTS_FILE="$ROOT_DIR/durable_queue/requirements.txt"
PACKAGE_LOCK_FILE="$ROOT_DIR/frontend/package-lock.json"
COMPOSE_FILE="$ROOT_DIR/scripts/verify-compose.yml"
PYTHON_BIN=""
COMPOSE_KIND=""
VERIFY_COMPOSE_PROJECT=""
VERIFY_POSTGRES_STARTED=0

usage() {
  cat <<'EOF'
Usage: ./scripts/verify.sh quick|full

  quick  Bootstrap dependencies and run checks that need no database or daemon.
  full   Run quick checks, application tests, builds, and infrastructure checks.

Set VERIFY_DATABASE_MODE=external for full verification against an already
running PostgreSQL service. POSTGRES_* variables must then describe that service.
EOF
}

fail() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

section() {
  printf '\n==> %s\n' "$1"
}

run() {
  local label="$1"
  shift
  section "$label"
  printf '+ '
  printf '%q ' "$@"
  printf '\n'
  "$@"
}

require_command() {
  local command_name="$1"
  local remediation="$2"
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required. $remediation"
}

file_sha256() {
  python3 - "$1" <<'PY'
import hashlib
import pathlib
import sys

print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
}

python_minor() {
  "$1" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'
}

select_python() {
  if [[ -x "$VENV_DIR/bin/python" ]]; then
    [[ "$(python_minor "$VENV_DIR/bin/python")" == "3.13" ]] || fail \
      "$VENV_DIR uses Python $(python_minor "$VENV_DIR/bin/python"); remove it and rerun with Python 3.13 available."
    PYTHON_BIN="$VENV_DIR/bin/python"
    return
  fi

  local candidate
  for candidate in python3.13 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && [[ "$(python_minor "$candidate")" == "3.13" ]]; then
      run "Create Python 3.13 virtual environment" "$candidate" -m venv "$VENV_DIR"
      PYTHON_BIN="$VENV_DIR/bin/python"
      return
    fi
  done

  fail "Python 3.13 is required. Install it, then rerun verification."
}

select_compose() {
  require_command docker "Install Docker Desktop or the Docker CLI."
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_KIND="plugin"
  elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    COMPOSE_KIND="standalone"
  else
    fail "Docker Compose is required. Install either 'docker compose' or 'docker-compose'."
  fi
}

compose() {
  if [[ "$COMPOSE_KIND" == "plugin" ]]; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

bootstrap_dependencies() {
  section "Environment preflight"
  require_command python3 "Install Python so the verification launcher can run."
  require_command node "Install Node.js 22."
  require_command npm "Install npm with Node.js 22."
  require_command terraform "Install Terraform 1.5 or newer."
  select_compose

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$node_major" == "22" ]] || fail "Node.js 22 is required; found $(node --version)."

  select_python

  local requirements_hash requirements_stamp
  requirements_hash="$(file_sha256 "$REQUIREMENTS_FILE")"
  requirements_stamp="$VENV_DIR/.durable_queue_requirements.sha256"
  if [[ ! -f "$requirements_stamp" ]] || [[ "$(<"$requirements_stamp")" != "$requirements_hash" ]]; then
    run "Install Python dependencies" "$PYTHON_BIN" -m pip install --disable-pip-version-check -r "$REQUIREMENTS_FILE"
    printf '%s\n' "$requirements_hash" > "$requirements_stamp"
  else
    printf 'Python dependencies are current.\n'
  fi

  local package_hash package_stamp
  package_hash="$(file_sha256 "$PACKAGE_LOCK_FILE")"
  package_stamp="$ROOT_DIR/frontend/node_modules/.durable_queue_package_lock.sha256"
  if [[ ! -f "$package_stamp" ]] || [[ "$(<"$package_stamp")" != "$package_hash" ]]; then
    run "Install frontend dependencies" npm --prefix "$ROOT_DIR/frontend" ci
    printf '%s\n' "$package_hash" > "$package_stamp"
  else
    printf 'Frontend dependencies are current.\n'
  fi
}

export_test_environment() {
  export SECRET_KEY="verification-secret-key-at-least-32-bytes"
  export TRANSCRIBER="fake"
  export TRANSCRIBE_SECONDS="0"
  export CELERY_VISIBILITY_TIMEOUT="3600"
  export FRONTEND_URL="http://test.example"
  export CELERY_BROKER_URL="redis://localhost:6379/0"
  export CELERY_RESULT_BACKEND="redis://localhost:6379/1"
  export GOOGLE_CLIENT_ID="verification.apps.googleusercontent.com"
  export GOOGLE_CLIENT_SECRET="verification-client-secret"
  export GOOGLE_REDIRECT_URI="http://localhost:8000/api/auth/google/callback"
}

cleanup_postgres() {
  if [[ "$VERIFY_POSTGRES_STARTED" == "1" ]]; then
    section "Clean up verification PostgreSQL"
    compose -f "$COMPOSE_FILE" -p "$VERIFY_COMPOSE_PROJECT" down --volumes --remove-orphans || true
  fi
}

start_local_postgres() {
  docker info >/dev/null 2>&1 || fail \
    "Docker daemon is not running. Start Docker Desktop or another Docker engine, then rerun full verification."

  export VERIFY_POSTGRES_PORT
  VERIFY_POSTGRES_PORT="$(python3 - <<'PY'
import socket

with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
  VERIFY_COMPOSE_PROJECT="dqverify$($PYTHON_BIN -c 'import hashlib, pathlib; print(hashlib.sha256(str(pathlib.Path.cwd()).encode()).hexdigest()[:12])')"

  export POSTGRES_DB="durable_queue_verify"
  export POSTGRES_USER="durable_queue_verify"
  export POSTGRES_PASSWORD="durable_queue_verify_password"
  export POSTGRES_HOST="127.0.0.1"
  export POSTGRES_PORT="$VERIFY_POSTGRES_PORT"

  VERIFY_POSTGRES_STARTED=1
  trap cleanup_postgres EXIT INT TERM
  run "Start isolated verification PostgreSQL" compose -f "$COMPOSE_FILE" -p "$VERIFY_COMPOSE_PROJECT" up -d

  local attempt
  for attempt in $(seq 1 60); do
    if compose -f "$COMPOSE_FILE" -p "$VERIFY_COMPOSE_PROJECT" exec -T postgres \
      pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      printf 'PostgreSQL is ready on 127.0.0.1:%s.\n' "$POSTGRES_PORT"
      return
    fi
    sleep 1
  done

  compose -f "$COMPOSE_FILE" -p "$VERIFY_COMPOSE_PROJECT" logs postgres || true
  fail "PostgreSQL did not become ready within 60 seconds."
}

use_external_postgres() {
  local variable
  for variable in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD POSTGRES_HOST POSTGRES_PORT; do
    [[ -n "${!variable:-}" ]] || fail "$variable is required when VERIFY_DATABASE_MODE=external."
  done
  printf 'Using external PostgreSQL at %s:%s.\n' "$POSTGRES_HOST" "$POSTGRES_PORT"
}

run_quick() {
  export_test_environment
  run "Check environment contract" python3 "$ROOT_DIR/scripts/check_env_parity.py"
  run "Test repository checkers" "$PYTHON_BIN" -m unittest discover -s "$ROOT_DIR/scripts/tests" -v
  run "Check architecture boundaries" python3 "$ROOT_DIR/scripts/check_architecture.py"
  run "Check repository knowledge contract" python3 "$ROOT_DIR/scripts/check_repo_contract.py"
  run "Run Django system checks" "$PYTHON_BIN" "$ROOT_DIR/durable_queue/manage.py" check
  run "Lint frontend" npm --prefix "$ROOT_DIR/frontend" run lint
  run "Check Terraform formatting" terraform -chdir="$ROOT_DIR/infra" fmt -check -recursive
  run "Check diff whitespace" git -C "$ROOT_DIR" diff --check
}

run_full() {
  if [[ "${VERIFY_DATABASE_MODE:-local}" == "external" ]]; then
    use_external_postgres
  else
    start_local_postgres
  fi

  run "Check for missing Django migrations" "$PYTHON_BIN" "$ROOT_DIR/durable_queue/manage.py" makemigrations --check --dry-run
  run "Run Django tests" "$PYTHON_BIN" "$ROOT_DIR/durable_queue/manage.py" test jobs
  run "Build frontend" npm --prefix "$ROOT_DIR/frontend" run build

  local terraform_root
  for terraform_root in infra infra/bootstrap infra/dns; do
    run "Initialize Terraform ($terraform_root)" terraform -chdir="$ROOT_DIR/$terraform_root" init -backend=false -input=false -lockfile=readonly
    run "Validate Terraform ($terraform_root)" terraform -chdir="$ROOT_DIR/$terraform_root" validate
  done

  run "Build backend Docker image" docker build -t durable-queue:verify -f "$ROOT_DIR/durable_queue/Dockerfile" "$ROOT_DIR/durable_queue"
  run "Check final diff whitespace" git -C "$ROOT_DIR" diff --check
}

case "$MODE" in
  quick|full)
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    fail "Unknown verification mode: $MODE"
    ;;
esac

cd "$ROOT_DIR"
bootstrap_dependencies
run_quick

if [[ "$MODE" == "full" ]]; then
  run_full
fi

section "Verification complete"
printf '%s verification passed.\n' "$MODE"
