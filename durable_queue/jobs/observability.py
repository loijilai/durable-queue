"""Task-lifecycle instrumentation, kept separate from jobs/tasks.py so that
Queue Wait logging never has to touch business logic.

Not one of the modules scripts/check_architecture.py restricts, so it is
free to import jobs.models and jobs.tasks.
"""

import logging

from celery.signals import task_postrun, task_prerun
from django.utils import timezone

from durable_queue.logging_context import job_id_var

from .models import TranscriptionJob
from .tasks import execute_job

logger = logging.getLogger(__name__)


@task_prerun.connect(sender=execute_job)
def _on_execute_job_prerun(sender=None, task_id=None, args=None, **_kwargs):
    job_id = args[0]
    job_id_var.set(job_id)

    created_at = (
        TranscriptionJob.objects.filter(pk=job_id)
        .values_list("created_at", flat=True)
        .first()
    )
    if created_at is None:
        return

    queue_wait_seconds = (timezone.now() - created_at).total_seconds()
    logger.info(
        "job picked up by worker",
        extra={"job_id": job_id, "queue_wait_seconds": queue_wait_seconds},
    )


@task_postrun.connect(sender=execute_job)
def _on_execute_job_postrun(sender=None, **_kwargs):
    job_id_var.set(None)
