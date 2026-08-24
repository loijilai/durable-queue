import logging

from celery import Task, shared_task
from jobs.services import mark_running, mark_succeeded, mark_failed
from jobs.transcribers import (
    get_transcriber,
    TranscriptionRetryableError,
    TranscriptionPermanentError,
)

logger = logging.getLogger(__name__)


def _classify_failure(exc):
    """下游節流/暫時性錯誤 vs. 輸入問題，讓失敗記錄可據以區分兩者。"""
    if isinstance(exc, TranscriptionRetryableError):
        return "downstream_retryable"
    if isinstance(exc, TranscriptionPermanentError):
        return "permanent_input"
    return "unclassified"


class ExecuteJobTask(Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        job_id = args[0]
        mark_failed(job_id, str(exc))
        logger.error(
            "job failed",
            extra={
                "job_id": job_id,
                "error_type": type(exc).__name__,
                "failure_reason": _classify_failure(exc),
            },
        )

        super().on_failure(exc, task_id, args, kwargs, einfo)


@shared_task(
    base=ExecuteJobTask,
    acks_late=True,
    autoretry_for=(ConnectionError, TimeoutError, TranscriptionRetryableError),
    max_retries=3,
    retry_backoff=True,
    retry_jitter=True,
)
def execute_job(job_id):
    job = mark_running(job_id)
    if job is None:
        return
    transcript = get_transcriber()(job.video_url)
    mark_succeeded(job.id, transcript)
