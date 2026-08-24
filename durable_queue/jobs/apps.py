from django.apps import AppConfig


class JobsConfig(AppConfig):
    name = 'jobs'

    def ready(self):
        from . import observability  # noqa: F401 — connects task lifecycle signals
