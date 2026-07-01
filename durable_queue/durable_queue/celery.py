import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "durable_queue.settings")

app = Celery("durable_queue")

app.config_from_object("django.conf:settings", namespace="CELERY")

app.autodiscover_tasks()
