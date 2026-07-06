import threading
from django.db import transaction, connection
from django.test import TransactionTestCase
from django.contrib.auth.models import User
from jobs.models import TranscriptionJob
import time
from jobs.services import mark_failed


class LockTest(TransactionTestCase):
    VALID_URL = "https://www.youtube.com/watch?v=test123"

    def test_concurrent_marks_are_serialized(self):
        # Arrange: 建一個 RUNNING 的 job
        user = User.objects.create_user(username="tester", password="x")
        job = TranscriptionJob.objects.create(
            owner=user, video_url=self.VALID_URL, status=TranscriptionJob.RUNNING
        )

        a_locked = threading.Event()

        def worker_a(job_id):
            """worker A 設定成succeeded"""
            with transaction.atomic():
                job = TranscriptionJob.objects.select_for_update().get(pk=job_id)
                a_locked.set()  # 宣告：我拿到鎖了
                # 這裡 hold 一下（讓 B 一定撞上來），再寫入、離開 atomic → commit
                time.sleep(3)
                job.status = TranscriptionJob.SUCCEEDED
                job.save()
            connection.close()

        def worker_b(job_id):
            """worker B 設定成failed"""
            a_locked.wait()  # 等 A 先拿到鎖才動手
            mark_failed(job_id, "error message")
            connection.close()

        # Act: 起兩個 thread、join
        threadA = threading.Thread(target=worker_a, args=(job.id,))
        threadB = threading.Thread(target=worker_b, args=(job.id,))

        threadA.start()
        threadB.start()

        threadA.join()
        threadB.join()

        job.refresh_from_db()

        # Assert: 最終 status 是確定性的那個；B 的效果沒被套用
        self.assertEqual(job.status, TranscriptionJob.SUCCEEDED)
