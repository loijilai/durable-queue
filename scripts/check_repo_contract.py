#!/usr/bin/env python3
"""Validate versioned repository knowledge and declared diagram assets."""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
RERUN = "./scripts/verify.sh quick"

MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
STATUS_RE = re.compile(r"^- Status:\s*([a-z-]+)\s*$", re.MULTILINE)

ACTIVE_PLAN_STATUSES = {
    "awaiting-approval",
    "active",
    "awaiting-final-review",
}
COMPLETED_PLAN_STATUSES = {"completed"}

DIAGRAM_ASSETS = (
    "docs/diagrams/sources/aws-infra.drawio",
    "docs/diagrams/sources/security-topology.drawio",
    "docs/diagrams/sources/deploy-pipeline.drawio",
    "docs/diagrams/sources/job-lifecycle.excalidraw",
    "tools/diagrams/build_security_topology.py",
    "tools/diagrams/build_deploy_pipeline.py",
    "tools/diagrams/build_auth_attacks.py",
    "frontend/public/diagrams/aws-infra.svg",
    "frontend/public/diagrams/sec-topology-network.svg",
    "frontend/public/diagrams/sec-topology-sg.svg",
    "frontend/public/diagrams/sec-topology-tls.svg",
    "frontend/public/diagrams/sec-pipeline-1-seed.svg",
    "frontend/public/diagrams/sec-pipeline-2-identity.svg",
    "frontend/public/diagrams/sec-pipeline-3-image.svg",
    "frontend/public/diagrams/sec-pipeline-4-state.svg",
    "frontend/public/diagrams/sec-pipeline-5-boot.svg",
    "frontend/src/lib/diagramScenes.ts",
    "frontend/src/assets/diagrams/1-queue-arch.excalidraw",
    "frontend/src/assets/diagrams/2-1-visibility-timeout.excalidraw",
    "frontend/src/assets/diagrams/2-worker-failure.excalidraw",
    "frontend/src/assets/diagrams/3-1-race-condition.excalidraw",
    "frontend/src/assets/diagrams/3-worker-stuck-duplicate.excalidraw",
    "frontend/src/assets/diagrams/4-sequence-concurrency.excalidraw",
    "frontend/src/assets/diagrams/5-scale-out.excalidraw",
    "frontend/src/assets/diagrams/auth-sequence-google-oidc.excalidraw",
    "frontend/src/assets/diagrams/8-auth-attack-1-state.excalidraw",
    "frontend/src/assets/diagrams/8-auth-attack-2-token.excalidraw",
    "frontend/src/assets/diagrams/8-auth-attack-3-linking.excalidraw",
    "docs/diagrams/rendered/1-queue-arch.png",
    "docs/diagrams/rendered/2-1-visibility-timeout.png",
    "docs/diagrams/rendered/2-worker-failure.png",
    "docs/diagrams/rendered/3-1-race-condition.png",
    "docs/diagrams/rendered/3-worker-stuck-duplicate.png",
    "docs/diagrams/rendered/4-sequence-concurrency.png",
    "docs/diagrams/rendered/5-scale-out.png",
    "docs/diagrams/rendered/auth-sequence-google-oidc.png",
)


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


def tracked_markdown(root: Path) -> list[Path]:
    result = subprocess.run(
        [
            "git",
            "-C",
            str(root),
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "*.md",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return sorted(
        path
        for line in result.stdout.splitlines()
        if line and (path := root / line).exists()
    )


def check_markdown_links(root: Path, paths: list[Path]) -> list[Violation]:
    violations: list[Violation] = []
    for path in paths:
        text = path.read_text(encoding="utf-8")
        for match in MARKDOWN_LINK_RE.finditer(text):
            raw_target = match.group(1).strip().strip("<>")
            target = unquote(raw_target.split("#", 1)[0])
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = (path.parent / target).resolve()
            if resolved.exists():
                continue
            violations.append(
                Violation(
                    path,
                    text.count("\n", 0, match.start()) + 1,
                    "REPO001",
                    f"Markdown link target does not exist: {raw_target}.",
                    "Repair the relative link or add the referenced tracked file.",
                )
            )
    return violations


def check_plan_statuses(root: Path) -> list[Violation]:
    violations: list[Violation] = []
    allowed_by_directory = {
        "active": ACTIVE_PLAN_STATUSES,
        "completed": COMPLETED_PLAN_STATUSES,
    }
    for directory, allowed in allowed_by_directory.items():
        plan_dir = root / "docs" / "exec-plans" / directory
        for path in sorted(plan_dir.glob("*.md")):
            text = path.read_text(encoding="utf-8")
            match = STATUS_RE.search(text)
            actual = match.group(1) if match else None
            if actual in allowed:
                continue
            expected = ", ".join(sorted(allowed))
            violations.append(
                Violation(
                    path,
                    text.count("\n", 0, match.start()) + 1 if match else 1,
                    "REPO002",
                    f"plan in {directory}/ must have one of these statuses: {expected}; "
                    f"found {actual or 'no status'}.",
                    "Set an allowed status or move the plan to the matching directory.",
                )
            )
    return violations


def check_product_spec_index(root: Path) -> list[Violation]:
    spec_dir = root / "docs" / "product-specs"
    index_path = spec_dir / "README.md"
    index_text = index_path.read_text(encoding="utf-8")
    linked_specs = {
        Path(match.group(1).split("#", 1)[0]).name
        for match in MARKDOWN_LINK_RE.finditer(index_text)
        if match.group(1).split("#", 1)[0].endswith(".md")
    }
    violations: list[Violation] = []
    for path in sorted(spec_dir.glob("*.md")):
        if path.name == "README.md" or path.name in linked_specs:
            continue
        violations.append(
            Violation(
                path,
                1,
                "REPO003",
                "product spec is not listed in docs/product-specs/README.md.",
                "Add the spec to the initiative index with an explicit status.",
            )
        )
    return violations


def check_diagram_assets(
    root: Path, assets: tuple[str, ...] = DIAGRAM_ASSETS
) -> list[Violation]:
    manifest = root / "docs" / "diagrams" / "README.md"
    return [
        Violation(
            manifest,
            1,
            "REPO004",
            f"diagram manifest asset does not exist: {asset}.",
            "Restore the declared source/generator/output or update the manifest and inventory together.",
        )
        for asset in assets
        if not (root / asset).exists()
    ]


def check_repository(root: Path, markdown_paths: list[Path] | None = None) -> list[Violation]:
    paths = markdown_paths if markdown_paths is not None else tracked_markdown(root)
    return [
        *check_markdown_links(root, paths),
        *check_plan_statuses(root),
        *check_product_spec_index(root),
        *check_diagram_assets(root),
    ]


def main() -> int:
    violations = check_repository(ROOT)
    if violations:
        print("Repository contract violations:", file=sys.stderr)
        for violation in violations:
            print(violation.render(ROOT), file=sys.stderr)
        return 1
    print("✓ Repository knowledge contract is valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
