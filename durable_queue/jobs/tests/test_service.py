from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from jobs.services import (
    claim_next_job,
    mark_failed,
    mark_succeeded,
    mark_pending,
    reclaim_job,
    TIMEOUT,
    ATTEMPT_LIMIT,
)
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

    def test_mark_succeeded_is_idempotent_when_already_succeeded(self):
        # Arrange：已經 SUCCEEDED 的 job 再被呼叫一次（at-least-once 重複執行情境）
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.SUCCEEDED
        )
        # Act / Assert：不該丟例外
        mark_succeeded(job.id, self.TRANSCRIPT)
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)

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

    def test_mark_failed_is_idempotent_when_already_failed(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.FAILED
        )
        # Act / Assert：不該丟例外
        mark_failed(job.id, self.ERROR)
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.FAILED)

    # mark pending
    def test_mark_pending_updates_running_job(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
        )
        # Act
        mark_pending(job.id)
        job.refresh_from_db()
        # Assert
        self.assertEqual(job.status, TranscriptionJob.PENDING)

    def test_mark_pending_raises_does_not_exist_when_job_is_not_found(self):
        with self.assertRaises(TranscriptionJob.DoesNotExist):
            mark_pending(1)

    def test_mark_pending_raises_value_error_when_job_is_not_running(self):
        # Arrange：用 SUCCEEDED（非 RUNNING 且不會觸發 idempotent 提早 return）
        TranscriptionJob.objects.create(
            id=1, video_url=self.VALID_URL, status=TranscriptionJob.SUCCEEDED
        )
        with self.assertRaises(ValueError):
            mark_pending(1)

    def test_mark_pending_is_idempotent_when_already_pending(self):
        # Arrange
        job = TranscriptionJob.objects.create(
            video_url=self.VALID_URL, status=TranscriptionJob.PENDING
        )
        # Act / Assert：不該丟例外
        mark_pending(job.id)
        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.PENDING)

    # reclaim job (lease / visibility timeout)
    def _make_running_job(self, claimed_secs_ago, attempt_count=1):
        """建一個 RUNNING job，claimed_at 設在指定秒數之前。"""
        return TranscriptionJob.objects.create(
            video_url=self.VALID_URL,
            status=TranscriptionJob.RUNNING,
            attempt_count=attempt_count,
            claimed_at=timezone.now() - timedelta(seconds=claimed_secs_ago),
        )

    def test_reclaim_job_returns_expired_job_to_pending_when_under_limit(self):
        # Arrange：租約已過期，但嘗試次數還沒到上限
        job = self._make_running_job(
            claimed_secs_ago=TIMEOUT + 1, attempt_count=ATTEMPT_LIMIT - 1
        )
        # Act
        reclaim_job()
        job.refresh_from_db()
        # Assert
        self.assertEqual(job.status, TranscriptionJob.PENDING)

    def test_reclaim_job_marks_failed_when_at_or_over_limit(self):
        # Arrange：租約已過期，且嘗試次數已達上限
        job = self._make_running_job(
            claimed_secs_ago=TIMEOUT + 1, attempt_count=ATTEMPT_LIMIT
        )
        # Act
        reclaim_job()
        job.refresh_from_db()
        # Assert：走 mark_failed，error 與 finished_at 都該被寫入（驗證沒被覆蓋）
        self.assertEqual(job.status, TranscriptionJob.FAILED)
        self.assertIsNotNone(job.error)
        self.assertIsNotNone(job.finished_at)

    def test_reclaim_job_leaves_unexpired_job_running(self):
        # Arrange：租約還在有效期內（剛 claim）
        job = self._make_running_job(claimed_secs_ago=0, attempt_count=1)
        # Act
        reclaim_job()
        job.refresh_from_db()
        # Assert：不該誤殺還活著的 job
        self.assertEqual(job.status, TranscriptionJob.RUNNING)
        self.assertEqual(job.attempt_count, 1)

    def test_reclaim_job_ignores_non_running_jobs(self):
        # Arrange：一個很舊的 PENDING job，reclaim 不該碰它
        pending = TranscriptionJob.objects.create(
            video_url=self.VALID_URL,
            status=TranscriptionJob.PENDING,
            claimed_at=timezone.now() - timedelta(seconds=TIMEOUT + 1),
        )
        # Act
        reclaim_job()
        pending.refresh_from_db()
        # Assert
        self.assertEqual(pending.status, TranscriptionJob.PENDING)

    def test_reclaim_job_skips_running_job_with_null_claimed_at(self):
        # Arrange：髒資料——RUNNING 但 claimed_at 是 None，不該 crash 也不該影響其他 job
        dirty = TranscriptionJob.objects.create(
            video_url=self.VALID_URL,
            status=TranscriptionJob.RUNNING,
            claimed_at=None,
        )
        expired = self._make_running_job(
            claimed_secs_ago=TIMEOUT + 1, attempt_count=ATTEMPT_LIMIT - 1
        )
        # Act
        reclaim_job()
        dirty.refresh_from_db()
        expired.refresh_from_db()
        # Assert：髒資料被跳過、保持原狀；正常的過期 job 照常被回收
        self.assertEqual(dirty.status, TranscriptionJob.RUNNING)
        self.assertEqual(expired.status, TranscriptionJob.PENDING)
