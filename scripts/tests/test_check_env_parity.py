import re
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.check_env_parity import (
    LAMBDA_ENV_RE,
    LAMBDA_ENVIRONMENT_SOURCE,
    DeploymentSource,
    reconcile,
)

# 泛用的假格式，只給 ReconcileTests 用來驗證對帳邏輯本身，不綁定任何真實部署來源。
FAKE_DEPLOYED_RE = re.compile(r"-e\s+([A-Z_][A-Z0-9_]*)=")


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

    def test_declared_with_lambda_pattern_matches_plaintext_and_secret_maps(self):
        """Lambda 的明文環境變數與由 handler 解析的機密都是 HCL map 的鍵。"""
        with TemporaryDirectory() as directory:
            path = Path(directory) / "worker.tf"
            path.write_text(
                "locals {\n"
                "  worker_secret_env_sources = {\n"
                '    BAZ = "arn:aws:secretsmanager:...:baz"\n'
                "  }\n"
                "}\n"
                "environment {\n"
                "  variables = {\n"
                '    FOO = "1"\n'
                "    BAR = local.bar\n"
                "  }\n"
                "}\n",
                encoding="utf-8",
            )
            source = DeploymentSource(
                label="worker.tf", path=path, pattern=LAMBDA_ENV_RE
            )

            self.assertEqual(source.declared(), {"FOO", "BAR", "BAZ"})

    def test_lambda_pattern_ignores_lowercase_and_mixed_case_keys(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "worker.tf"
            path.write_text(
                'resource "aws_lambda_function" "worker" {\n'
                '  function_name = "durable-queue-worker"\n'
                "  Version = \"2012-10-17\"\n"
                "  variables = {\n"
                '    FOO = "1"\n'
                "  }\n"
                "}\n",
                encoding="utf-8",
            )
            source = DeploymentSource(
                label="worker.tf", path=path, pattern=LAMBDA_ENV_RE
            )

            self.assertEqual(source.declared(), {"FOO"})


class ReconcileTests(TestCase):
    """核心對帳邏輯：只依賴傳入的 DeploymentSource，不知道它背後是哪個檔案格式。"""

    def make_source(self, directory: str, contents: str) -> DeploymentSource:
        path = Path(directory) / "deployed.txt"
        path.write_text(contents, encoding="utf-8")
        return DeploymentSource(label="fake-source", path=path, pattern=FAKE_DEPLOYED_RE)

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

    def test_library_owned_variables_are_not_reported_as_dead_config(self):
        """依賴（yt-dlp）讀、我們的程式碼不讀的變數，不是死設定。"""
        with TemporaryDirectory() as directory:
            source = self.make_source(directory, "-e FOO=1 -e XDG_CACHE_HOME=/tmp")
            ok = reconcile(
                required={"FOO"},
                optional=set(),
                documented={"FOO"},
                deployment_source=source,
            )

        self.assertTrue(ok)

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


class RegressionAgainstRealWorkerDeploymentTests(TestCase):
    """驗收條件：對帳的預設來源是 Worker 的 Lambda function 環境設定。"""

    def test_default_source_points_at_the_worker_lambda(self):
        self.assertEqual(LAMBDA_ENVIRONMENT_SOURCE.label, "infra/worker.tf")
        self.assertIn("aws_lambda_function", LAMBDA_ENVIRONMENT_SOURCE.path.read_text(encoding="utf-8"))

    def test_label_is_derived_from_path_and_cannot_drift_from_it(self):
        from scripts.check_env_parity import ROOT

        self.assertEqual(
            LAMBDA_ENVIRONMENT_SOURCE.label,
            str(LAMBDA_ENVIRONMENT_SOURCE.path.relative_to(ROOT)),
        )

    def test_real_repository_env_contract_is_consistent(self):
        from scripts.check_env_parity import ENV_EXAMPLE, main

        self.assertTrue(ENV_EXAMPLE.exists())
        self.assertEqual(main(), 0)
