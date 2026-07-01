from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from jobs.models import TranscriptionJob


class TranscriptionJobAPITests(APITestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    INVALID_URL = "htt://www.youtube.com/watch?v=test123"

    def test_create_job(self):
        # Arrange
        url = reverse("job-create")
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
        url = reverse("job-create")
        data = {"video_url": self.INVALID_URL}

        # Act
        response = self.client.post(url, data, format="json")

        # Assert
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(TranscriptionJob.objects.count(), 0)
        self.assertIn("video_url", response.data)

    def test_retrieve_job(self):
        # Arrange
        job = TranscriptionJob.objects.create(video_url=self.VALID_URL)
        url = reverse("job-detail", kwargs={"pk": job.pk})

        # Act
        response = self.client.get(url, format="json")

        # Assert
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["id"], job.id)
        self.assertEqual(response.data["video_url"], job.video_url)
        self.assertEqual(response.data["status"], TranscriptionJob.PENDING)

    def test_retrieve_job_not_found(self):
        # Arrange
        url = reverse("job-detail", kwargs={"pk": 1})

        # Act
        response = self.client.get(url, format="json")

        # Assert
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
