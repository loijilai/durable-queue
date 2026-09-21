import json
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from jobs.queue import enqueue_job


class EnqueueJobTests(SimpleTestCase):
    """Message contract: the body the API sends is the format the Worker handler parses."""

    @override_settings(JOB_QUEUE_URL="http://sqs.test/000000000000/jobs")
    @patch("jobs.queue.sqs_client")
    def test_sends_job_id_as_json_body_to_configured_queue(self, mock_sqs_client):
        # Arrange
        client = MagicMock()
        mock_sqs_client.return_value = client

        # Act
        enqueue_job(42)

        # Assert
        client.send_message.assert_called_once()
        kwargs = client.send_message.call_args.kwargs
        self.assertEqual(kwargs["QueueUrl"], "http://sqs.test/000000000000/jobs")
        self.assertEqual(json.loads(kwargs["MessageBody"]), {"job_id": 42})
