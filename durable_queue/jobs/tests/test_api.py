from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from jobs.models import TranscriptionJob
from unittest.mock import patch


class TranscriptionJobAPITests(APITestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    INVALID_URL = "htt://www.youtube.com/watch?v=test123"

    def test_create_job(self):
        # Arrange
        url = reverse("job-list-create")
        data = {"video_url": self.VALID_URL}

        # Act
        response = self.client.post(url, data, format="json")

        # Assert
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(TranscriptionJob.objects.count(), 1)

        job = TranscriptionJob.objects.get()
        self.assertEqual(job.status, response.data["status"])
        self.assertEqual(response.data["id"], job.id)

    def test_invalid_url_create_job(self):
        # Arrange
        url = reverse("job-list-create")
        data = {"video_url": self.INVALID_URL}

        # Act
        response = self.client.post(url, data, format="json")

        # Assert
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(TranscriptionJob.objects.count(), 0)
        self.assertIn("video_url", response.data)

    @patch("jobs.views.execute_job.delay")
    def test_retry_failed_job_dispatches_task(self, mock_execute_job):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.FAILED
        )
        url = reverse("job-retry", kwargs={"job_id": job.id})

        # Act：POST job-retry
        response = self.client.post(url)

        # Assert：202 + execute_job.delay 有被呼叫（用 job.id）
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        mock_execute_job.assert_called_once_with(job.id)
