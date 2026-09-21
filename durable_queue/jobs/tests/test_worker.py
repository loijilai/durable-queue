import json
import logging
import os
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from durable_queue.logging_context import JobIdFilter
from jobs.models import TranscriptionJob
from jobs.services import retry_job
from jobs.transcribers import InvalidMediaError, TranscriptionTimeoutError
from jobs.worker import handler

User = get_user_model()

QUEUE_URL = "http://sqs.test/000000000000/durable-queue-jobs"


def sqs_event(job_id, receive_count=1, receipt_handle="receipt-handle-1"):
    """The SQS event shape Lambda hands the handler when the ESM batch_size is 1."""
    return {
        "Records": [
            {
                "messageId": "message-1",
                "receiptHandle": receipt_handle,
                "body": json.dumps({"job_id": job_id}),
                "attributes": {"ApproximateReceiveCount": str(receive_count)},
                "eventSource": "aws:sqs",
            }
        ]
    }


@override_settings(JOB_QUEUE_URL=QUEUE_URL)
class WorkerHandlerTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    TRANSCRIPT = "This is a test script"
    ERROR = "This is a test error message"

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="tester", password="x")

    def setUp(self):
        patcher = patch("jobs.queue.sqs_client")
        self.sqs = MagicMock()
        patcher.start().return_value = self.sqs
        self.addCleanup(patcher.stop)

    def make_job(self, status=TranscriptionJob.PENDING, **fields):
        return TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=status, **fields
        )

    def prior_attempts(self, count):
        """worker_attempts entries left by earlier executions of the same Job."""
        return [
            {"host": "worker-host", "at": "2026-01-01T00:00:00+00:00"}
        ] * count

    def test_successful_transcription_marks_job_succeeded(self):
        # Arrange
        job = self.make_job()

        # Act
        handler(sqs_event(job.id), None)

        # Assert
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)
        self.assertEqual(job.transcript, self.TRANSCRIPT)
        self.assertIsNotNone(job.finished_at)

    @patch("jobs.transcribers.fake_transcribe", side_effect=InvalidMediaError(ERROR))
    def test_permanent_error_fails_job_on_first_attempt(self, mock_transcribe):
        # Arrange
        job = self.make_job()

        # Act: returns normally, no exception
        handler(sqs_event(job.id), None)

        # Assert
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertEqual(job.error, self.ERROR)
        self.assertIsNotNone(job.finished_at)
        self.sqs.change_message_visibility.assert_not_called()

    def test_transient_error_before_last_attempt_backs_off_and_raises(self):
        """A transient error is left to SQS: shorten visibility as the backoff, then
        raise so the message is not deleted."""
        for error_type in (TranscriptionTimeoutError, ConnectionError, TimeoutError):
            with self.subTest(error_type=error_type.__name__):
                # Arrange: this delivery is the second execution
                self.sqs.reset_mock()
                job = self.make_job(
                    status=TranscriptionJob.RUNNING,
                    worker_attempts=self.prior_attempts(1),
                )

                # Act
                with patch(
                    "jobs.transcribers.fake_transcribe",
                    side_effect=error_type(self.ERROR),
                ):
                    with self.assertRaises(error_type):
                        handler(sqs_event(job.id, receipt_handle="rh-2"), None)

                # Assert
                job.refresh_from_db()
                self.assertEqual(job.status, TranscriptionJob.RUNNING)
                self.sqs.change_message_visibility.assert_called_once()
                kwargs = self.sqs.change_message_visibility.call_args.kwargs
                self.assertEqual(kwargs["QueueUrl"], QUEUE_URL)
                self.assertEqual(kwargs["ReceiptHandle"], "rh-2")
                self.assertIsInstance(kwargs["VisibilityTimeout"], int)
                # attempt 2 -> ceiling 60s; equal jitter never retries immediately
                self.assertGreaterEqual(kwargs["VisibilityTimeout"], 30)
                self.assertLessEqual(kwargs["VisibilityTimeout"], 60)

    @patch(
        "jobs.transcribers.fake_transcribe",
        side_effect=TranscriptionTimeoutError(ERROR),
    )
    def test_high_receive_count_does_not_consume_attempts(self, mock_transcribe):
        """Deliveries spent waiting for capacity (throttled invocations, expired
        visibility) are not executions, so they never make an attempt the last one."""
        # Arrange: delivered many times, but executed only once before
        job = self.make_job(
            status=TranscriptionJob.RUNNING, worker_attempts=self.prior_attempts(1)
        )

        # Act
        with self.assertRaises(TranscriptionTimeoutError):
            handler(sqs_event(job.id, receive_count=9), None)

        # Assert
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.RUNNING)
        self.assertEqual(len(job.worker_attempts), 2)
        self.sqs.change_message_visibility.assert_called_once()

    @patch(
        "jobs.transcribers.fake_transcribe",
        side_effect=TranscriptionTimeoutError(ERROR),
    )
    def test_transient_error_on_last_attempt_fails_job(self, mock_transcribe):
        """Fourth execution still fails: the handler records failed rather than the
        message cycling on toward the DLQ."""
        # Arrange: three earlier executions; this delivery arrives with a low
        # receive count so only the execution count can make it the last attempt
        job = self.make_job(
            status=TranscriptionJob.RUNNING, worker_attempts=self.prior_attempts(3)
        )

        # Act: returns normally
        handler(sqs_event(job.id), None)

        # Assert
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertEqual(job.error, self.ERROR)
        self.assertIsNotNone(job.finished_at)
        self.assertEqual(len(job.worker_attempts), 4)
        self.sqs.change_message_visibility.assert_not_called()

    @patch(
        "jobs.transcribers.fake_transcribe",
        side_effect=TranscriptionTimeoutError(ERROR),
    )
    def test_manual_retry_starts_a_fresh_attempt_budget(self, mock_transcribe):
        """Executions before a manual retry stay in the audit trail but no longer
        count toward MAX_ATTEMPTS."""
        # Arrange: a Job that used up all its attempts, then retried by its owner
        job = self.make_job(
            status=TranscriptionJob.FAILED,
            error=self.ERROR,
            worker_attempts=self.prior_attempts(4),
        )
        retry_job(job.id)

        # Act
        with self.assertRaises(TranscriptionTimeoutError):
            handler(sqs_event(job.id), None)

        # Assert
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.RUNNING)
        self.assertEqual(len(job.worker_attempts), 5)
        self.sqs.change_message_visibility.assert_called_once()

    def test_redelivery_to_terminal_job_has_no_effect(self):
        """Redelivery to a terminal Job: no re-transcription, no overwritten result."""
        for status, fields in (
            (TranscriptionJob.SUCCEEDED, {"transcript": self.TRANSCRIPT}),
            (TranscriptionJob.FAILED, {"error": self.ERROR}),
        ):
            with self.subTest(status=status):
                # Arrange
                job = self.make_job(status=status, **fields)

                # Act
                with patch("jobs.transcribers.fake_transcribe") as mock_transcribe:
                    handler(sqs_event(job.id), None)

                # Assert
                mock_transcribe.assert_not_called()
                job.refresh_from_db()
                self.assertEqual(job.status, status)
                self.assertEqual(job.transcript, fields.get("transcript"))
                self.assertEqual(job.error, fields.get("error"))

    def capture_logs(self):
        """Collect records through the production JobIdFilter, so assertions see the emitted fields."""
        records = []

        class Collector(logging.Handler):
            def emit(self, record):
                records.append(record)

        collector = Collector(level=logging.INFO)
        collector.addFilter(JobIdFilter())
        root = logging.getLogger()
        root.addHandler(collector)
        self.addCleanup(root.removeHandler, collector)
        return records

    @patch.dict(os.environ, {"TRANSCRIBE_SECONDS": "0"})
    def test_every_log_line_during_execution_carries_job_id(self):
        # Arrange
        job = self.make_job()
        records = self.capture_logs()

        # Act
        handler(sqs_event(job.id), None)
        logging.getLogger("jobs.tests").info("after invocation")

        # Assert
        *during, after = records
        self.assertTrue(
            any(r.getMessage() == "transcription stage completed" for r in during)
        )
        self.assertEqual({r.job_id for r in during}, {job.id})
        self.assertIsNone(after.job_id)

        [pickup] = [r for r in during if r.getMessage() == "job picked up by worker"]
        self.assertIsInstance(pickup.queue_wait_seconds, float)
        self.assertGreaterEqual(pickup.queue_wait_seconds, 0)

    @patch("jobs.transcribers.fake_transcribe", side_effect=InvalidMediaError(ERROR))
    def test_failure_log_line_carries_failure_reason(self, mock_transcribe):
        # Arrange
        job = self.make_job()
        records = self.capture_logs()

        # Act
        handler(sqs_event(job.id), None)

        # Assert
        [failed] = [r for r in records if r.getMessage() == "job failed"]
        self.assertEqual(failed.job_id, job.id)
        self.assertEqual(failed.error_type, "InvalidMediaError")
        self.assertEqual(failed.failure_reason, "permanent_input")

    @patch("jobs.transcribers.fake_transcribe", side_effect=ValueError(ERROR))
    def test_unclassified_error_fails_job_on_first_attempt(self, mock_transcribe):
        """An unclassified error is most likely a bug; surface it instead of retrying it away."""
        # Arrange
        job = self.make_job()

        # Act
        handler(sqs_event(job.id), None)

        # Assert
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertEqual(job.error, self.ERROR)
        self.sqs.change_message_visibility.assert_not_called()
