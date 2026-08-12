#!/usr/bin/env python3
"""Enforce the small set of Durable Queue production-code boundaries."""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = ROOT / "durable_queue" / "jobs"
RERUN = "./scripts/verify.sh quick"

ALLOWED_JOB_IMPORTS = {
    "models": set(),
    "serializers": {"jobs.models"},
    "services": {"jobs.models"},
    "transcribers": set(),
    "tasks": {"jobs.services", "jobs.transcribers"},
    "views": {"jobs.models", "jobs.serializers", "jobs.services", "jobs.tasks"},
}

LIFECYCLE_FIELDS = {
    "status",
    "transcript",
    "error",
    "finished_at",
    "worker_attempts",
}


@dataclass(frozen=True)
class Violation:
    path: Path
    line: int
    code: str
    message: str
    remediation: str

    def render(self, root: Path) -> str:
        try:
            display_path = self.path.relative_to(root)
        except ValueError:
            display_path = self.path
        return (
            f"{display_path}:{self.line}: {self.code} {self.message}\n"
            f"  Remediation: {self.remediation}\n"
            f"  Rerun: {RERUN}"
        )


def _job_modules(node: ast.Import | ast.ImportFrom) -> set[str]:
    if isinstance(node, ast.ImportFrom):
        if node.level == 1 and node.module:
            return {f"jobs.{node.module.split('.')[0]}"}
        if node.level == 0 and node.module == "jobs":
            return {f"jobs.{alias.name.split('.')[0]}" for alias in node.names}
        if node.level == 0 and node.module and node.module.startswith("jobs."):
            return {".".join(node.module.split(".")[:2])}
        return set()

    return {
        ".".join(alias.name.split(".")[:2])
        for alias in node.names
        if alias.name.startswith("jobs.")
    }


def _check_imports(path: Path, module: str, tree: ast.AST) -> list[Violation]:
    violations: list[Violation] = []
    allowed = ALLOWED_JOB_IMPORTS[module]
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            continue
        for imported in sorted(_job_modules(node) - allowed):
            violations.append(
                Violation(
                    path,
                    node.lineno,
                    "ARCH001",
                    f"jobs.{module} may not depend on {imported}.",
                    "Move the operation behind an allowed lower-level boundary. "
                    f"Allowed jobs imports: {', '.join(sorted(allowed)) or 'none'}.",
                )
            )
    return violations


def _check_lifecycle_mutations(path: Path, module: str, tree: ast.AST) -> list[Violation]:
    if module in {"models", "services"}:
        return []

    violations: list[Violation] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Store):
            if node.attr in LIFECYCLE_FIELDS:
                violations.append(
                    Violation(
                        path,
                        node.lineno,
                        "ARCH002",
                        f"job lifecycle field '{node.attr}' is mutated outside services.py.",
                        "Add or reuse a transactional operation in jobs/services.py.",
                    )
                )

        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            protected_keywords = {
                keyword.arg
                for keyword in node.keywords
                if keyword.arg in LIFECYCLE_FIELDS
            }
            if node.func.attr == "update" and protected_keywords:
                violations.append(
                    Violation(
                        path,
                        node.lineno,
                        "ARCH003",
                        "queryset update mutates lifecycle fields outside services.py: "
                        + ", ".join(sorted(protected_keywords)),
                        "Move the update into jobs/services.py and preserve its transaction and row lock.",
                    )
                )

        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "setattr"
            and len(node.args) >= 2
            and isinstance(node.args[1], ast.Constant)
            and node.args[1].value in LIFECYCLE_FIELDS
        ):
            violations.append(
                Violation(
                    path,
                    node.lineno,
                    "ARCH004",
                    f"setattr mutates lifecycle field '{node.args[1].value}' outside services.py.",
                    "Move the mutation into a transactional operation in jobs/services.py.",
                )
            )
    return violations


def check_jobs_directory(jobs_dir: Path) -> list[Violation]:
    violations: list[Violation] = []
    for module in sorted(ALLOWED_JOB_IMPORTS):
        path = jobs_dir / f"{module}.py"
        if not path.exists():
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except SyntaxError as error:
            violations.append(
                Violation(
                    path,
                    error.lineno or 1,
                    "ARCH000",
                    f"cannot parse module: {error.msg}.",
                    "Fix the Python syntax error before checking architecture.",
                )
            )
            continue
        violations.extend(_check_imports(path, module, tree))
        violations.extend(_check_lifecycle_mutations(path, module, tree))
    return violations


def main() -> int:
    violations = check_jobs_directory(JOBS_DIR)
    if violations:
        print("Architecture contract violations:", file=sys.stderr)
        for violation in violations:
            print(violation.render(ROOT), file=sys.stderr)
        return 1
    print("✓ Architecture boundaries are valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
