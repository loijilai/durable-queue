from django.test import TestCase
from jobs.tasks import execute_job
from jobs.models import TranscriptionJob
from unittest.mock import patch


class ExecuteJobTaskTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    TRANSCRIPT = "This is a test script"
    ERROR = "This is a test error message"

    def test_execute_job_succeeded(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )
        # Act
        execute_job(job.id)
        job.refresh_from_db()
        # Assert
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)
        self.assertEqual(job.transcript, self.TRANSCRIPT)
        self.assertIsNotNone(job.finished_at)

    @patch("jobs.tasks.fake_transcribe", side_effect=ConnectionError(ERROR))
    def test_execute_job_failed(self, mock_transcribe):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )

        # Act
        execute_job.apply(args=[job.id])
        job.refresh_from_db()

        # Assert
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertEqual(job.error, self.ERROR)
        self.assertIsNotNone(job.finished_at)
        self.assertEqual(mock_transcribe.call_count, 4)
