import re
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.check_env_parity import (
    DOCKER_ENV_RE,
    USER_DATA_SOURCE,
    DeploymentSource,
    reconcile,
)


class DeploymentSourceTests(TestCase):
    """對帳的第三方來源本身：任何路徑 + 任何解析規則都能組成一個來源。"""

    def test_declared_parses_with_the_configured_pattern(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "task-definition.json"
            path.write_text(
                '{"environment": [{"name": "FOO"}, {"name": "BAR"}]}',
                encoding="utf-8",
            )
            source = DeploymentSource(
                label="task-definition.json",
                path=path,
                pattern=re.compile(r'"name":\s*"([A-Z_][A-Z0-9_]*)"'),
            )

            self.assertEqual(source.declared(), {"FOO", "BAR"})

    def test_declared_with_docker_env_pattern_matches_user_data_style(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "user_data.sh.tftpl"
            path.write_text("docker run -e FOO=1 -e BAR=$${BAR}\n", encoding="utf-8")
            source = DeploymentSource(label="user_data", path=path, pattern=DOCKER_ENV_RE)

            self.assertEqual(source.declared(), {"FOO", "BAR"})


class ReconcileTests(TestCase):
    """核心對帳邏輯：只依賴傳入的 DeploymentSource，不知道它背後是哪個檔案格式。"""

    def make_source(self, directory: str, contents: str) -> DeploymentSource:
        path = Path(directory) / "deployed.txt"
        path.write_text(contents, encoding="utf-8")
        return DeploymentSource(label="fake-source", path=path, pattern=DOCKER_ENV_RE)

    def test_passes_when_all_three_lists_agree(self):
        with TemporaryDirectory() as directory:
            source = self.make_source(directory, "-e FOO=1 -e BAR=2")
            ok = reconcile(
                required={"FOO", "BAR"},
                optional=set(),
                documented={"FOO", "BAR"},
                deployment_source=source,
            )

        self.assertTrue(ok)

    def test_fails_when_required_var_missing_from_deployment_source(self):
        with TemporaryDirectory() as directory:
            source = self.make_source(directory, "-e FOO=1")
            ok = reconcile(
                required={"FOO", "BAR"},
                optional=set(),
                documented={"FOO", "BAR"},
                deployment_source=source,
            )

        self.assertFalse(ok)

    def test_fails_when_deployment_source_declares_dead_config(self):
        with TemporaryDirectory() as directory:
            source = self.make_source(directory, "-e FOO=1 -e DEAD=1")
            ok = reconcile(
                required={"FOO"},
                optional=set(),
                documented={"FOO"},
                deployment_source=source,
            )

        self.assertFalse(ok)

    def test_optional_vars_are_not_required_from_deployment_source(self):
        with TemporaryDirectory() as directory:
            source = self.make_source(directory, "-e FOO=1")
            ok = reconcile(
                required={"FOO"},
                optional={"OPTIONAL_WITH_DEFAULT"},
                documented={"FOO", "OPTIONAL_WITH_DEFAULT"},
                deployment_source=source,
            )

        self.assertTrue(ok)

    def test_source_is_swappable_without_changing_reconcile_logic(self):
        """把來源換成完全不同格式/路徑的檔案，對帳邏輯不需要跟著改。"""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "task-definition.json"
            path.write_text('{"env": [{"name": "FOO"}]}', encoding="utf-8")
            alternate_source = DeploymentSource(
                label="task-definition.json",
                path=path,
                pattern=re.compile(r'"name":\s*"([A-Z_][A-Z0-9_]*)"'),
            )

            ok = reconcile(
                required={"FOO"},
                optional=set(),
                documented={"FOO"},
                deployment_source=alternate_source,
            )

        self.assertTrue(ok)


class RegressionAgainstRealUserDataTests(TestCase):
    """驗收條件：對現行機器開機腳本的對帳結果，改動前後必須完全一致。"""

    def test_default_source_still_points_at_user_data_template(self):
        self.assertEqual(USER_DATA_SOURCE.label, "infra/user_data.sh.tftpl")
        self.assertTrue(USER_DATA_SOURCE.path.name == "user_data.sh.tftpl")

    def test_label_is_derived_from_path_and_cannot_drift_from_it(self):
        from scripts.check_env_parity import ROOT

        self.assertEqual(USER_DATA_SOURCE.label, str(USER_DATA_SOURCE.path.relative_to(ROOT)))

    def test_real_repository_env_contract_is_consistent(self):
        from scripts.check_env_parity import ENV_EXAMPLE, main

        self.assertTrue(ENV_EXAMPLE.exists())
        self.assertEqual(main(), 0)
