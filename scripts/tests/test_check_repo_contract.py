from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.check_repo_contract import (
    check_diagram_assets,
    check_markdown_links,
    check_plan_statuses,
    check_product_spec_index,
    tracked_markdown,
)


class RepositoryContractCheckerTests(TestCase):
    def test_markdown_discovery_uses_current_worktree_paths(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            old = root / "old.md"
            old.write_text("# Old\n", encoding="utf-8")
            subprocess.run(["git", "-C", str(root), "add", "old.md"], check=True)
            old.unlink()
            current = root / "current.md"
            current.write_text("# Current\n", encoding="utf-8")

            paths = tracked_markdown(root)

        self.assertEqual([path.name for path in paths], ["current.md"])

    def test_broken_markdown_link_is_rejected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            document = root / "README.md"
            document.write_text("[missing](docs/missing.md)\n", encoding="utf-8")

            violations = check_markdown_links(root, [document])

        self.assertEqual([violation.code for violation in violations], ["REPO001"])
        self.assertEqual(violations[0].line, 1)

    def test_active_directory_accepts_each_in_progress_state(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            active = root / "docs" / "exec-plans" / "active"
            completed = root / "docs" / "exec-plans" / "completed"
            active.mkdir(parents=True)
            completed.mkdir(parents=True)
            for status in ("awaiting-approval", "active", "awaiting-final-review"):
                (active / f"{status}.md").write_text(
                    f"- Status: {status}\n", encoding="utf-8"
                )

            violations = check_plan_statuses(root)

        self.assertEqual(violations, [])

    def test_completed_status_is_rejected_in_active_directory(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            active = root / "docs" / "exec-plans" / "active"
            completed = root / "docs" / "exec-plans" / "completed"
            active.mkdir(parents=True)
            completed.mkdir(parents=True)
            (active / "wrong.md").write_text("- Status: completed\n", encoding="utf-8")

            violations = check_plan_statuses(root)

        self.assertEqual([violation.code for violation in violations], ["REPO002"])

    def test_review_state_is_rejected_in_completed_directory(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            active = root / "docs" / "exec-plans" / "active"
            completed = root / "docs" / "exec-plans" / "completed"
            active.mkdir(parents=True)
            completed.mkdir(parents=True)
            (completed / "wrong.md").write_text(
                "- Status: awaiting-final-review\n", encoding="utf-8"
            )

            violations = check_plan_statuses(root)

        self.assertEqual([violation.code for violation in violations], ["REPO002"])

    def test_unindexed_product_spec_is_rejected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            specs = root / "docs" / "product-specs"
            specs.mkdir(parents=True)
            (specs / "README.md").write_text("# Product specs\n", encoding="utf-8")
            (specs / "new-feature.md").write_text("# New feature\n", encoding="utf-8")

            violations = check_product_spec_index(root)

        self.assertEqual([violation.code for violation in violations], ["REPO003"])

    def test_missing_diagram_asset_is_rejected(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "docs" / "diagrams"
            manifest.mkdir(parents=True)
            (manifest / "README.md").write_text("# Diagrams\n", encoding="utf-8")

            violations = check_diagram_assets(root, ("docs/diagrams/source.drawio",))

        self.assertEqual([violation.code for violation in violations], ["REPO004"])

    def test_valid_contract_fragments_pass(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            document = root / "README.md"
            target = root / "docs" / "current.md"
            target.parent.mkdir()
            target.write_text("# Current\n", encoding="utf-8")
            document.write_text("[current](docs/current.md)\n", encoding="utf-8")

            active = root / "docs" / "exec-plans" / "active"
            completed = root / "docs" / "exec-plans" / "completed"
            active.mkdir(parents=True)
            completed.mkdir(parents=True)
            (active / "plan.md").write_text(
                "- Status: awaiting-approval\n", encoding="utf-8"
            )
            (active / "work.md").write_text("- Status: active\n", encoding="utf-8")
            (active / "review.md").write_text(
                "- Status: awaiting-final-review\n", encoding="utf-8"
            )
            (completed / "done.md").write_text("- Status: completed\n", encoding="utf-8")

            specs = root / "docs" / "product-specs"
            specs.mkdir()
            (specs / "feature.md").write_text("# Feature\n", encoding="utf-8")
            (specs / "README.md").write_text("[feature](feature.md)\n", encoding="utf-8")

            diagram_dir = root / "docs" / "diagrams"
            diagram_dir.mkdir()
            (diagram_dir / "README.md").write_text("# Diagrams\n", encoding="utf-8")
            asset = diagram_dir / "source.drawio"
            asset.write_text("diagram", encoding="utf-8")

            violations = [
                *check_markdown_links(root, [document]),
                *check_plan_statuses(root),
                *check_product_spec_index(root),
                *check_diagram_assets(root, ("docs/diagrams/source.drawio",)),
            ]

        self.assertEqual(violations, [])
