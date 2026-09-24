from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from jobs.models import TranscriptionJob
from unittest.mock import patch

User = get_user_model()


class TranscriptionJobAPITests(APITestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    INVALID_URL = "htt://www.youtube.com/watch?v=test123"

    def setUp(self):
        # 每個測試都以登入身份出發（授權隔離另在 test_authz.py 測）
        self.user = User.objects.create_user(username="tester", password="x")
        self.client.force_authenticate(user=self.user)

    @patch("jobs.views.enqueue_job")
    def test_create_job(self, mock_enqueue_job):
        # Arrange
        url = reverse("job-list-create")
        data = {"video_url": self.VALID_URL}

        # Act：on-commit callback 在 block 結束時才執行，模擬 DB commit
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(url, data, format="json")
            mock_enqueue_job.assert_not_called()

        # Assert
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(TranscriptionJob.objects.count(), 1)

        job = TranscriptionJob.objects.get()
        self.assertEqual(job.status, response.data["status"])
        self.assertEqual(response.data["id"], job.id)
        # 建立只回一個指標：最小 body + 指向 detail 的 Location
        self.assertEqual(set(response.data), {"id", "status", "created_at"})
        self.assertTrue(
            response["Location"].endswith(
                reverse("job-detail", kwargs={"pk": job.id})
            ),
            response["Location"],
        )
        mock_enqueue_job.assert_called_once_with(job.id)

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

    @patch("jobs.views.enqueue_job")
    def test_retry_failed_job_enqueues_after_commit(self, mock_enqueue_job):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.FAILED
        )
        url = reverse("job-retry", kwargs={"job_id": job.id})

        # Act：POST job-retry，commit 之前不得送出
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(url)
            mock_enqueue_job.assert_not_called()

        # Assert：202 + 無 body + 指向 detail 的 Location + commit 後送進佇列
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(response.content, b"")
        self.assertTrue(
            response["Location"].endswith(
                reverse("job-detail", kwargs={"pk": job.id})
            ),
            response["Location"],
        )
        mock_enqueue_job.assert_called_once_with(job.id)

    @patch("jobs.views.enqueue_job")
    def test_retry_non_failed_job_returns_409(self, mock_enqueue_job):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
        )
        url = reverse("job-retry", kwargs={"job_id": job.id})

        # Act
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(url)

        # Assert
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        mock_enqueue_job.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.RUNNING)

    def test_list_returns_summary_without_full_transcript(self):
        # Arrange：一份長到會被裁切的逐字稿
        transcript = "x" * 600
        job = TranscriptionJob.objects.create(
            owner=self.user,
            video_url=self.VALID_URL,
            status=TranscriptionJob.SUCCEEDED,
            transcript=transcript,
        )

        # Act
        response = self.client.get(reverse("job-list-create"))

        # Assert：list 只給預覽與長度，全文與 owner 都不在
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            set(response.data[0]),
            {
                "id",
                "video_url",
                "status",
                "error",
                "created_at",
                "finished_at",
                "worker_attempts",
                "transcript_preview",
                "transcript_length",
            },
        )
        self.assertEqual(response.data[0]["transcript_preview"], transcript[:500])
        self.assertEqual(response.data[0]["transcript_length"], len(transcript))
        self.assertEqual(response.data[0]["id"], job.id)

    def test_detail_returns_full_transcript(self):
        # Arrange
        transcript = "x" * 600
        job = TranscriptionJob.objects.create(
            owner=self.user,
            video_url=self.VALID_URL,
            status=TranscriptionJob.SUCCEEDED,
            transcript=transcript,
        )

        # Act
        response = self.client.get(reverse("job-detail", kwargs={"pk": job.id}))

        # Assert
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            set(response.data),
            {
                "id",
                "video_url",
                "status",
                "transcript",
                "error",
                "created_at",
                "finished_at",
                "worker_attempts",
            },
        )
        self.assertEqual(response.data["transcript"], transcript)
