from django.test import TestCase
from django.contrib.auth import get_user_model
from jobs.serializers import TranscriptionJobSerializer
from jobs.models import TranscriptionJob

User = get_user_model()


class TranscriptionJobSerializerTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    INVALID_URL = "htt://www.youtube.com/watch?v=test123"

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="tester", password="x")

    def test_valid_url_creates_pending_job(self):
        # Arrange
        input_data = {"video_url": self.VALID_URL}

        # Act
        serializer = TranscriptionJobSerializer(data=input_data)

        # Assert
        self.assertTrue(serializer.is_valid(), serializer.errors)
        job = serializer.save(owner=self.user)

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
        job = serializer.save(owner=self.user)

        # status is not changed by client
        self.assertEqual(job.status, TranscriptionJob.PENDING)
