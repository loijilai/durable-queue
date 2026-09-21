"""The Lambda entry point: the contract between the function configuration and
the handler is the secret ARNs the cold start resolves into the environment."""

import json
import os
from unittest import TestCase
from unittest.mock import MagicMock, patch

from durable_queue.lambda_handler import bootstrap
from durable_queue.lambda_handler import handler as lambda_handler
from durable_queue.lambda_handler import load_secret_environment
from jobs.worker import handler

APP_SECRET_ARN = "arn:aws:secretsmanager:ap-northeast-1:1:secret:durable-queue-app-Ab1"
DB_SECRET_ARN = "arn:aws:secretsmanager:ap-northeast-1:1:secret:rds!db-2f3-Cd2"


def secrets_client(payloads):
    client = MagicMock()
    client.get_secret_value.side_effect = lambda SecretId: {
        "SecretString": json.dumps(payloads[SecretId])
    }
    return client


class LoadSecretEnvironmentTests(TestCase):
    def cleanup_variables(self, *names):
        for name in names:
            self.addCleanup(os.environ.pop, name, None)

    def test_resolves_each_variable_from_its_json_key(self):
        # Arrange
        self.cleanup_variables("SECRET_KEY", "GOOGLE_CLIENT_ID")
        client = secrets_client(
            {APP_SECRET_ARN: {"secret_key": "s3cret", "google_client_id": "client-id"}}
        )

        # Act
        load_secret_environment(
            {
                "SECRET_KEY": f"{APP_SECRET_ARN}:secret_key",
                "GOOGLE_CLIENT_ID": f"{APP_SECRET_ARN}:google_client_id",
            },
            client,
        )

        # Assert
        self.assertEqual(os.environ["SECRET_KEY"], "s3cret")
        self.assertEqual(os.environ["GOOGLE_CLIENT_ID"], "client-id")

    def test_fetches_each_secret_once_however_many_variables_it_carries(self):
        # Arrange
        self.cleanup_variables("SECRET_KEY", "GOOGLE_CLIENT_ID", "POSTGRES_PASSWORD")
        client = secrets_client(
            {
                APP_SECRET_ARN: {"secret_key": "s3cret", "google_client_id": "client-id"},
                DB_SECRET_ARN: {"password": "db-password"},
            }
        )

        # Act
        load_secret_environment(
            {
                "SECRET_KEY": f"{APP_SECRET_ARN}:secret_key",
                "GOOGLE_CLIENT_ID": f"{APP_SECRET_ARN}:google_client_id",
                "POSTGRES_PASSWORD": f"{DB_SECRET_ARN}:password",
            },
            client,
        )

        # Assert
        self.assertEqual(os.environ["POSTGRES_PASSWORD"], "db-password")
        self.assertEqual(client.get_secret_value.call_count, 2)


class BootstrapTests(TestCase):
    """本機的 .env 從 .env.example 複製而來，SECRET_ENV_SOURCES 是空字串——
    那代表「沒有機密要解析」，不是一份要被 parse 的 JSON。"""

    @patch.dict(os.environ, {"SECRET_ENV_SOURCES": ""})
    @patch("durable_queue.lambda_handler.boto3.client")
    def test_empty_sources_resolves_nothing_and_never_calls_secrets_manager(
        self, mock_client
    ):
        # Act
        bootstrap()

        # Assert
        mock_client.assert_not_called()


class EntryPointTests(TestCase):
    def test_module_exposes_the_same_handler_the_local_shim_calls(self):
        # Assert
        self.assertIs(lambda_handler, handler)
