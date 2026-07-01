import threading
import time
from unittest.mock import patch

from django.test import TransactionTestCase
from django.utils import timezone as django_timezone

from jobs.models import TranscriptionJob
from jobs.services import claim_next_job


class ClaimNextJobConcurrencyTests(TransactionTestCase):
    """驗證多個 worker 同時呼叫 claim_next_job 時，同一筆 job 不會被搶兩次。

    用 TransactionTestCase 而非 TestCase，因為 TestCase 把整個測試包在單一
    transaction 裡不會真的 commit，無法模擬不同 connection 真正並發存取的情境。
    """

    VALID_URL = "https://www.youtube.com/watch?v=test123"

    def test_two_concurrent_workers_do_not_claim_same_job(self):
        job = TranscriptionJob.objects.create(video_url=self.VALID_URL)

        results = []
        results_lock = threading.Lock()

        def worker():
            claimed = claim_next_job()
            with results_lock:
                results.append(claimed)

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        claimed_jobs = [j for j in results if j is not None]
        self.assertEqual(
            len(claimed_jobs),
            1,
            f"expected exactly 1 worker to claim the job, got {len(claimed_jobs)}",
        )

        job.refresh_from_db()
        self.assertEqual(job.status, TranscriptionJob.RUNNING)
        self.assertEqual(job.attempt_count, 1)
