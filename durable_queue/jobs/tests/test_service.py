from django.test import TestCase
from jobs.services import claim_next_job, mark_failed, mark_succeeded
from jobs.models import TranscriptionJob


class TranscriptionServiceTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    TRANSCRIPT = "This is a test transcript"
    ERROR = "This is a test error message"

    # claim job
    def test_claim_next_job_claims_oldest_pending_job(self):
        # Arrange
        job1 = TranscriptionJob.objects.create(video_url=self.VALID_URL)
        job2 = TranscriptionJob.objects.create(video_url=self.VALID_URL)
        # Act
        claimed_job = claim_next_job()
        job1.refresh_from_db()  # 確保資料真的有被claim_next_job改動並寫進資料庫
        job2.refresh_from_db()
        # Assert
        self.assertEqual(job1.id, claimed_job.id)
        self.assertEqual(job1.attempt_count, 1)
        self.assertEqual(job1.status, TranscriptionJob.RUNNING)
        self.assertIsNotNone(job1.claimed_at)
        self.assertEqual(job2.status, TranscriptionJob.PENDING)
        self.assertIsNone(job2.claimed_at)

    def test_claim_next_job_returns_none_when_queue_is_empty(self):
        # Act
        claimed_job = claim_next_job()
        # Assert
        self.assertIsNone(claimed_job)

    def test_claim_next_job_returns_none_when_no_pending_job_exists(self):
        # Arrange
        TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
        )
        TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.FAILED
        )
        TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.SUCCEEDED
        )
        # Act
        claimed_job = claim_next_job()
        # Assert
        self.assertIsNone(claimed_job)

    # mark succeeded
    def test_mark_succeeded_updates_running_job(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
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
            id=1, video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )
        with self.assertRaises(ValueError):
            mark_succeeded(1, self.TRANSCRIPT)

    # mark failed
    def test_mark_failed_updates_running_job(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
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
            id=1, video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )
        with self.assertRaises(ValueError):
            mark_failed(1, self.ERROR)
