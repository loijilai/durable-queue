from django.test import TestCase
from django.contrib.auth import get_user_model
from jobs.services import mark_failed, mark_succeeded, retry_job
from jobs.models import TranscriptionJob

User = get_user_model()


class TranscriptionServiceTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    TRANSCRIPT = "This is a test transcript"
    ERROR = "This is a test error message"

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="tester", password="x")

    # mark succeeded
    def test_mark_succeeded_updates_running_job(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
        )
        # Act
        mark_succeeded(job.id, self.TRANSCRIPT)
        job.refresh_from_db()
        # Assert
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)
        self.assertEqual(job.transcript, self.TRANSCRIPT)
        self.assertIsNotNone(job.finished_at)

    def test_mark_succeeded_raises_does_not_exist_when_job_is_not_found(self):
        with self.assertRaises(TranscriptionJob.DoesNotExist):
            mark_succeeded(1, self.TRANSCRIPT)

    def test_mark_succeeded_raises_value_error_when_job_is_not_running(self):
        # Arrange
        TranscriptionJob.objects.create(
            id=1, owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )
        with self.assertRaises(ValueError):
            mark_succeeded(1, self.TRANSCRIPT)

    def test_mark_succeeded_is_idempotent_when_already_succeeded(self):
        # Arrange：已經 SUCCEEDED 的 job 再被呼叫一次（at-least-once 重複執行情境）
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.SUCCEEDED
        )
        # Act / Assert：不該丟例外
        mark_succeeded(job.id, self.TRANSCRIPT)
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)

    # mark failed
    def test_mark_failed_updates_running_job(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
        )
        # Act
        mark_failed(job.id, self.ERROR)
        job.refresh_from_db()
        # Assert
        self.assertEqual(job.error, self.ERROR)
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertIsNotNone(job.finished_at)

    def test_mark_failed_raises_does_not_exist_when_job_is_not_found(self):
        with self.assertRaises(TranscriptionJob.DoesNotExist):
            mark_failed(1, self.ERROR)

    def test_mark_failed_raises_value_error_when_job_is_not_running(self):
        # Arrange
        TranscriptionJob.objects.create(
            id=1, owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )
        with self.assertRaises(ValueError):
            mark_failed(1, self.ERROR)

    def test_mark_failed_is_idempotent_when_already_failed(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.FAILED
        )
        # Act / Assert：不該丟例外
        mark_failed(job.id, self.ERROR)
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.FAILED)

    # retry job
    def test_retry_job_resets_failed_job_to_pending(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.FAILED
        )
        # Act
        retry_job(job.id)
        job.refresh_from_db()
        # Assert
        self.assertEqual(job.status, TranscriptionJob.PENDING)
        self.assertIsNone(job.error)
        self.assertIsNone(job.finished_at)

    def test_retry_job_raises_value_error_when_job_is_not_failed(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.SUCCEEDED
        )
        # Act / Assert
        with self.assertRaises(ValueError):
            retry_job(job.id)

    def test_retry_job_raises_does_not_exist_when_job_is_not_found(self):
        # Act / Assert
        with self.assertRaises(TranscriptionJob.DoesNotExist):
            retry_job(10)
