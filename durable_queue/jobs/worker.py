"""The Worker's only entry point. Lambda's SQS event source mapping
(batch_size = 1) invokes handler; locally, the run_worker management command
builds an event of the same shape and calls it."""

import json
import logging
import random

from django.utils import timezone

from durable_queue.logging_context import job_id_var
from jobs import queue
from jobs.services import mark_failed, mark_running, mark_succeeded
from jobs.transcribers import (
    TranscriptionPermanentError,
    TranscriptionRetryableError,
    get_transcriber,
)

logger = logging.getLogger(__name__)

TRANSIENT_ERRORS = (TranscriptionRetryableError, ConnectionError, TimeoutError)
# The first attempt plus three retries, counted as executions since the last
# manual retry (TranscriptionJob.attempts_since_retry), not SQS deliveries: a
# delivery that waited for capacity, or was throttled, never ran the Job and
# must not spend a retry. The queue's maxReceiveCount sits above this, so the
# DLQ only catches messages the handler never managed to record a result for.
MAX_ATTEMPTS = 4
BACKOFF_BASE_SECONDS = 30
BACKOFF_CAP_SECONDS = 300


def _classify_failure(exc):
    """Separates downstream throttling/transient trouble from input problems in the failure log."""
    if isinstance(exc, TranscriptionRetryableError):
        return "downstream_retryable"
    if isinstance(exc, TranscriptionPermanentError):
        return "permanent_input"
    return "unclassified"


def _fail(job_id, exc):
    mark_failed(job_id, str(exc))
    logger.error(
        "job failed",
        extra={
            "job_id": job_id,
            "error_type": type(exc).__name__,
            "failure_reason": _classify_failure(exc),
        },
    )


def _backoff_seconds(attempt):
    """Exponential backoff with equal jitter: at least half the ceiling, so a
    retry is never immediate, and capped far below the queue's visibility timeout."""
    ceiling = min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** (attempt - 1))
    return ceiling // 2 + random.randint(0, ceiling // 2)


def handler(event, context):
    [record] = event["Records"]
    job_id = json.loads(record["body"])["job_id"]

    # Every log line during execution carries the job id. A warm Lambda reuses the
    # process, so the id must be cleared when the invocation ends.
    token = job_id_var.set(job_id)
    try:
        _execute(record, job_id)
    finally:
        job_id_var.reset(token)


def _execute(record, job_id):
    job = mark_running(job_id)
    if job is None:
        return
    # Logged only when the Job actually starts executing; a redelivery to a
    # terminal Job is not a Queue Wait sample.
    logger.info(
        "job picked up by worker",
        extra={"queue_wait_seconds": (timezone.now() - job.created_at).total_seconds()},
    )
    # mark_running has just recorded this execution.
    attempt = job.attempts_since_retry
    try:
        transcript = get_transcriber()(job.video_url)
    except TRANSIENT_ERRORS as exc:
        if attempt >= MAX_ATTEMPTS:
            _fail(job.id, exc)
            return
        # Keep the message: shorten its visibility so SQS redelivers it after the
        # backoff.
        queue.sqs_client().change_message_visibility(
            QueueUrl=queue.job_queue_url(),
            ReceiptHandle=record["receiptHandle"],
            VisibilityTimeout=_backoff_seconds(attempt),
        )
        raise
    except Exception as exc:
        _fail(job.id, exc)
        return
    mark_succeeded(job.id, transcript)
