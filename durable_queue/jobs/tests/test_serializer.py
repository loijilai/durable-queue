from django.test import TestCase
from jobs.serializers import TranscriptionJobSerializer
from jobs.models import TranscriptionJob


class TranscriptionJobSerializerTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    INVALID_URL = "htt://www.youtube.com/watch?v=test123"

    def test_valid_url_creates_pending_job(self):
        # Arrange
        input_data = {"video_url": self.VALID_URL}

        # Act
        serializer = TranscriptionJobSerializer(data=input_data)

        # Assert
        self.assertTrue(serializer.is_valid(), serializer.errors)
        job = serializer.save()

        self.assertEqual(job.status, TranscriptionJob.PENDING)
        self.assertEqual(job.video_url, self.VALID_URL)
        self.assertIsNotNone(job.created_at)
        self.assertEqual(TranscriptionJob.objects.count(), 1)

    def test_invalid_url_is_rejected(self):
        # Arrange
        input_data = {"video_url": self.INVALID_URL}

        # Act
        serializer = TranscriptionJobSerializer(data=input_data)

        # Assert
        self.assertFalse(serializer.is_valid())

    def test_client_cannot_set_status(self):
        # Arrange
        input_data = {"video_url": self.VALID_URL, "status": "finished"}

        # Act
        serializer = TranscriptionJobSerializer(data=input_data)

        # Assert
        self.assertTrue(serializer.is_valid(), serializer.errors)
        job = serializer.save()

        # status is not changed by client
        self.assertEqual(job.status, TranscriptionJob.PENDING)
