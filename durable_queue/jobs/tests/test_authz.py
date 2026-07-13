from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from rest_framework import status
from jobs.models import TranscriptionJob
from unittest.mock import patch

User = get_user_model()


class JobAuthzTests(APITestCase):
    """per-user 授權：使用者只能看到 / 動到自己的 job。"""

    VALID_URL = "https://www.youtube.com/watch?v=test123"

    @classmethod
    def setUpTestData(cls):
        cls.alice = User.objects.create_user(
            username="alice", email="alice@test.com", password="x"
        )
        cls.bob = User.objects.create_user(
            username="bob", email="bob@test.com", password="x"
        )

    def _make_job(self, owner, status=TranscriptionJob.PENDING):
        return TranscriptionJob.objects.create(
            owner=owner, video_url=self.VALID_URL, status=status
        )

    # --- 正向：自己對自己的 job ---

    def test_create_stamps_request_user_as_owner(self):
        # Arrange
        self.client.force_authenticate(user=self.alice)
        # Act
        resp = self.client.post(
            reverse("job-list-create"), {"video_url": self.VALID_URL}, format="json"
        )
        # Assert：owner 由 request.user 蓋章，不是 client 傳的
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data["owner"], self.alice.id)

    def test_list_returns_only_own_jobs(self):
        # Arrange：故意放一個 bob 的 job 當誘餌
        mine = self._make_job(self.alice)
        self._make_job(self.bob)
        self.client.force_authenticate(user=self.alice)
        # Act
        resp = self.client.get(reverse("job-list-create"))
        # Assert：只看得到自己的那一筆
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]["id"], mine.id)

    def test_detail_own_job_ok(self):
        # Arrange
        mine = self._make_job(self.alice)
        self.client.force_authenticate(user=self.alice)
        # Act
        resp = self.client.get(reverse("job-detail", kwargs={"pk": mine.id}))
        # Assert
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["owner"], self.alice.id)

    @patch("jobs.views.execute_job.delay")
    def test_retry_own_failed_job(self, mock_delay):
        # Arrange
        mine = self._make_job(self.alice, status=TranscriptionJob.FAILED)
        self.client.force_authenticate(user=self.alice)
        # Act
        resp = self.client.post(reverse("job-retry", kwargs={"job_id": mine.id}))
        # Assert
        self.assertEqual(resp.status_code, status.HTTP_202_ACCEPTED)
        mock_delay.assert_called_once_with(mine.id)

    # --- 隔離：別人的 job（回 404，不洩漏存在性）---

    def test_detail_others_job_returns_404(self):
        # Arrange：bob 的 job，alice 來查
        others = self._make_job(self.bob)
        self.client.force_authenticate(user=self.alice)
        # Act
        resp = self.client.get(reverse("job-detail", kwargs={"pk": others.id}))
        # Assert
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    @patch("jobs.views.execute_job.delay")
    def test_retry_others_job_returns_404_and_does_not_mutate(self, mock_delay):
        """回歸測試：修好的 check-after-act。
        bob 的 FAILED job 被 alice retry，必須 404，且 job 完全沒被改動。"""
        # Arrange
        others = self._make_job(self.bob, status=TranscriptionJob.FAILED)
        self.client.force_authenticate(user=self.alice)
        # Act
        resp = self.client.post(reverse("job-retry", kwargs={"job_id": others.id}))
        # Assert：404 + 沒有派工 + 從 DB 重撈確認狀態沒被改
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)
        mock_delay.assert_not_called()
        others.refresh_from_db()
        self.assertEqual(others.status, TranscriptionJob.FAILED)

    # --- 匿名：完全沒 token（default-deny 地基）---

    def test_anonymous_is_denied(self):
        # Arrange：不呼叫 force_authenticate → 匿名
        job = self._make_job(self.alice)
        list_url = reverse("job-list-create")
        detail_url = reverse("job-detail", kwargs={"pk": job.id})
        retry_url = reverse("job-retry", kwargs={"job_id": job.id})
        # Act / Assert：每個端點都應被擋（401）
        self.assertEqual(
            self.client.get(list_url).status_code, status.HTTP_401_UNAUTHORIZED
        )
        self.assertEqual(
            self.client.post(list_url, {"video_url": self.VALID_URL}).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            self.client.get(detail_url).status_code, status.HTTP_401_UNAUTHORIZED
        )
        self.assertEqual(
            self.client.post(retry_url).status_code, status.HTTP_401_UNAUTHORIZED
        )
