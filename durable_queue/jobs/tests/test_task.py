from django.test import TestCase
from django.contrib.auth import get_user_model
from jobs.tasks import execute_job
from jobs.models import TranscriptionJob
from unittest.mock import patch

User = get_user_model()


class ExecuteJobTaskTests(TestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"
    TRANSCRIPT = "This is a test script"
    ERROR = "This is a test error message"

    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user(username="tester", password="x")

    def test_execute_job_succeeded(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.PENDING
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
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )

        # Act
        execute_job.apply(args=[job.id])
        job.refresh_from_db()

        # Assert
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertEqual(job.error, self.ERROR)
        self.assertIsNotNone(job.finished_at)
        self.assertEqual(mock_transcribe.call_count, 4)

    # --- 重複派送（redelivery）四種情境 ---
    # 對應 worker crash 卡在「DB commit ↔ ACK」不同空隙時，重送的 job 會處於哪個狀態。

    def test_redelivery_pending_runs_normally(self):
        """PENDING 重送：worker 拿到 task、還沒寫 RUNNING 就掛。
        重送後應如同第一次執行，正常跑完 → SUCCEEDED。"""
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )
        # Act
        execute_job(job.id)
        job.refresh_from_db()
        # Assert
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)
        self.assertEqual(job.transcript, self.TRANSCRIPT)
        self.assertIsNotNone(job.finished_at)

    @patch("jobs.tasks.fake_transcribe", return_value=TRANSCRIPT)
    def test_redelivery_running_reruns_transcribe(self, mock_transcribe):
        """RUNNING 重送：worker A transcribe 途中掛，job 停在 RUNNING。
        worker B 拿不到 A 的成果，必須重跑 transcribe → 最終 SUCCEEDED。"""
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
        )
        # Act
        execute_job(job.id)
        job.refresh_from_db()
        # Assert
        self.assertEqual(mock_transcribe.call_count, 1)
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)

    @patch("jobs.tasks.fake_transcribe")
    def test_redelivery_succeeded_skips(self, mock_transcribe):
        """SUCCEEDED 重送：job 已完成、ACK 前掛。guard 應攔住，不重跑 transcribe。"""
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL,
            status=TranscriptionJob.SUCCEEDED,
            transcript=self.TRANSCRIPT,
        )
        # Act
        execute_job(job.id)
        job.refresh_from_db()
        # Assert
        mock_transcribe.assert_not_called()
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)
        self.assertEqual(job.transcript, self.TRANSCRIPT)

    @patch("jobs.tasks.fake_transcribe")
    def test_redelivery_failed_skips(self, mock_transcribe):
        """FAILED 重送：job 已失敗、ACK 前掛。guard 應攔住，不重跑 transcribe。"""
        # Arrange
        job = TranscriptionJob.objects.create(
            owner=self.user, video_url=self.VALID_URL,
            status=TranscriptionJob.FAILED,
            error=self.ERROR,
        )
        # Act
        execute_job(job.id)
        job.refresh_from_db()
        # Assert
        mock_transcribe.assert_not_called()
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertEqual(job.error, self.ERROR)
