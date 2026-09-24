from django.test import TestCase
from django.contrib.auth import get_user_model
from jobs.serializers import (
    TRANSCRIPT_PREVIEW_LENGTH,
    JobCreateSerializer,
    JobSummarySerializer,
)
from jobs.models import TranscriptionJob

User = get_user_model()


class JobCreateSerializerTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    INVALID_URL = "htt://www.youtube.com/watch?v=test123"

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="tester", password="x")

    def test_valid_url_creates_pending_job(self):
        # Arrange
        input_data = {"video_url": self.VALID_URL}

        # Act
        serializer = JobCreateSerializer(data=input_data)

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
        serializer = JobCreateSerializer(data=input_data)

        # Assert
        self.assertFalse(serializer.is_valid())

    def test_client_cannot_set_status(self):
        # Arrange
        input_data = {"video_url": self.VALID_URL, "status": "finished"}

        # Act
        serializer = JobCreateSerializer(data=input_data)

        # Assert
        self.assertTrue(serializer.is_valid(), serializer.errors)
        job = serializer.save(owner=self.user)

        # status is not changed by client
        self.assertEqual(job.status, TranscriptionJob.PENDING)


class JobSummarySerializerTranscriptTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="summary-tester", password="x")

    def _serialize(self, transcript):
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, transcript=transcript
        )
        return JobSummarySerializer(job).data

    def test_no_transcript_yields_null_preview_and_length(self):
        # Arrange / Act
        data = self._serialize(None)

        # Assert
        self.assertIsNone(data["transcript_preview"])
        self.assertIsNone(data["transcript_length"])

    def test_short_transcript_is_returned_whole(self):
        # Arrange
        transcript = "a" * (TRANSCRIPT_PREVIEW_LENGTH - 1)

        # Act
        data = self._serialize(transcript)

        # Assert
        self.assertEqual(data["transcript_preview"], transcript)
        self.assertEqual(data["transcript_length"], len(transcript))

    def test_long_transcript_is_truncated_but_length_is_full(self):
        # Arrange
        transcript = "b" * (TRANSCRIPT_PREVIEW_LENGTH + 123)

        # Act
        data = self._serialize(transcript)

        # Assert：preview 只到 500 字，length 仍是全文長度
        self.assertEqual(
            data["transcript_preview"], transcript[:TRANSCRIPT_PREVIEW_LENGTH]
        )
        self.assertEqual(data["transcript_length"], len(transcript))

    def test_summary_omits_full_transcript_and_owner(self):
        # Arrange / Act
        data = self._serialize("c" * 10)

        # Assert
        self.assertNotIn("transcript", data)
        self.assertNotIn("owner", data)
