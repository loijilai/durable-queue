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
# The first attempt plus three retries. Must equal the queue's maxReceiveCount,
# so the last transient failure is recorded as failed by the handler instead
# of the message silently moving to the DLQ.
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


def _backoff_seconds(receive_count):
    """Exponential backoff with equal jitter: at least half the ceiling, so a
    retry is never immediate, and capped far below the queue's visibility timeout."""
    ceiling = min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** (receive_count - 1))
    return ceiling // 2 + random.randint(0, ceiling // 2)


def handler(event, context):
    [record] = event["Records"]
    job_id = json.loads(record["body"])["job_id"]
    receive_count = int(record["attributes"]["ApproximateReceiveCount"])

    # Every log line during execution carries the job id. A warm Lambda reuses the
    # process, so the id must be cleared when the invocation ends.
    token = job_id_var.set(job_id)
    try:
        _execute(record, job_id, receive_count)
    finally:
        job_id_var.reset(token)


def _execute(record, job_id, receive_count):
    job = mark_running(job_id)
    if job is None:
        return
    # Logged only when the Job actually starts executing; a redelivery to a
    # terminal Job is not a Queue Wait sample.
    logger.info(
        "job picked up by worker",
        extra={"queue_wait_seconds": (timezone.now() - job.created_at).total_seconds()},
    )
    try:
        transcript = get_transcriber()(job.video_url)
    except TRANSIENT_ERRORS as exc:
        if receive_count >= MAX_ATTEMPTS:
            _fail(job.id, exc)
            return
        # Keep the message: shorten its visibility so SQS redelivers it after the
        # backoff. The receive count is the retry counter.
        queue.sqs_client().change_message_visibility(
            QueueUrl=queue.job_queue_url(),
            ReceiptHandle=record["receiptHandle"],
            VisibilityTimeout=_backoff_seconds(receive_count),
        )
        raise
    except Exception as exc:
        _fail(job.id, exc)
        return
    mark_succeeded(job.id, transcript)
