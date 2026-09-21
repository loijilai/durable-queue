"""Lambda's entry point for the Worker, the counterpart of wsgi.py for the API.

Lambda's runtime interface client imports this module at cold start and calls
``handler``. Everything Django needs from the environment must be in place
before ``django.setup()`` runs, so the secrets are resolved here first.
"""

import json
import os

import boto3
import django


def load_secret_environment(sources, client):
    """Resolves ``{"VAR": "<secret arn>:<json key>"}`` into environment variables.

    An ECS task definition declares secrets and the agent injects them; Lambda
    has no equivalent, and putting the values in the function's environment
    would leave them in plaintext on the function configuration. So the function
    declares only ARNs, in the same form the ECS ``secrets`` field uses, and the
    cold start resolves them. Each secret is fetched once however many variables
    it carries.
    """
    fetched = {}
    for name, source in sources.items():
        secret_arn, _, json_key = source.rpartition(":")
        if secret_arn not in fetched:
            response = client.get_secret_value(SecretId=secret_arn)
            fetched[secret_arn] = json.loads(response["SecretString"])
        os.environ[name] = fetched[secret_arn][json_key]


def bootstrap():
    # Empty and unset both mean "nothing to resolve": .env.example ships the key
    # with no value, because locally the secrets are in .env already.
    sources = json.loads(os.environ.get("SECRET_ENV_SOURCES") or "{}")
    if sources:
        load_secret_environment(sources, boto3.client("secretsmanager"))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "durable_queue.settings")
    django.setup()


bootstrap()

# Imported after the bootstrap: jobs.worker reaches Django settings at import.
from jobs.worker import handler  # noqa: E402

__all__ = ["handler"]
