import os

from django.conf import settings
from django.test import TestCase

from durable_queue.celery import app


class CeleryConfigTests(TestCase):
    def test_prefetch_multiplier_is_one(self):
        # 指標正確性的前提：預取的訊息會轉為不可見，Backlog 會顯示成已消化
        self.assertEqual(app.conf.worker_prefetch_multiplier, 1)

    def test_result_backend_is_disabled(self):
        # Result backend 刪除而非遷移：Job 狀態的真相在 Postgres
        self.assertIsNone(app.conf.result_backend)
        self.assertFalse(hasattr(settings, "CELERY_RESULT_BACKEND"))

    def test_broker_transport_options_carry_visibility_timeout_and_region(self):
        self.assertEqual(
            app.conf.broker_transport_options["visibility_timeout"],
            int(os.environ["CELERY_VISIBILITY_TIMEOUT"]),
        )
        self.assertIn("region", app.conf.broker_transport_options)
