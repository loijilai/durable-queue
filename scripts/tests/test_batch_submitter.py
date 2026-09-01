import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import MagicMock, patch

from scripts.batch_submitter import (
    get_access_token,
    main,
    run_burst,
    submit_job,
    write_results,
)


def _response(status_code, json_body=None, text=""):
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_body or {}
    response.text = text
    response.raise_for_status.side_effect = (
        None if status_code < 400 else Exception(f"HTTP {status_code}")
    )
    return response


class GetAccessTokenTests(TestCase):
    @patch("scripts.batch_submitter.requests.post")
    def test_returns_access_token_from_response(self, mock_post):
        mock_post.return_value = _response(200, {"access": "jwt-token"})

        token = get_access_token("http://localhost:8000", "alice", "secret")

        self.assertEqual(token, "jwt-token")
        mock_post.assert_called_once_with(
            "http://localhost:8000/api/auth/token/",
            json={"username": "alice", "password": "secret"},
            timeout=30,
        )


class SubmitJobTests(TestCase):
    @patch("scripts.batch_submitter.requests.post")
    def test_accepted_job_records_job_id_and_no_error(self, mock_post):
        mock_post.return_value = _response(201, {"id": 42})

        result = submit_job("http://localhost:8000", "jwt-token", "https://v/1", 0)

        self.assertEqual(result["index"], 0)
        self.assertEqual(result["status_code"], 201)
        self.assertEqual(result["job_id"], 42)
        self.assertIsNone(result["error"])
        self.assertIn("submitted_at", result)

    @patch("scripts.batch_submitter.requests.post")
    def test_rejected_job_records_error_and_no_job_id(self, mock_post):
        mock_post.return_value = _response(400, text="bad video_url")

        result = submit_job("http://localhost:8000", "jwt-token", "not-a-url", 1)

        self.assertEqual(result["status_code"], 400)
        self.assertIsNone(result["job_id"])
        self.assertEqual(result["error"], "bad video_url")

    @patch("scripts.batch_submitter.requests.post")
    def test_network_failure_is_recorded_not_raised(self, mock_post):
        import requests

        mock_post.side_effect = requests.ConnectionError("connection refused")

        result = submit_job("http://localhost:8000", "jwt-token", "https://v/1", 2)

        self.assertIsNone(result["status_code"])
        self.assertIsNone(result["job_id"])
        self.assertIn("connection refused", result["error"])

    @patch("scripts.batch_submitter.requests.post")
    def test_timestamp_is_captured_before_the_request_is_sent(self, mock_post):
        call_order = []

        def fake_post(*args, **kwargs):
            call_order.append("request_sent")
            return _response(201, {"id": 1})

        mock_post.side_effect = fake_post

        def fake_now(tz):
            call_order.append("timestamped")
            return MagicMock(isoformat=lambda: "2026-08-31T00:00:00+00:00")

        with patch("scripts.batch_submitter.datetime") as mock_datetime:
            mock_datetime.now.side_effect = fake_now
            submit_job("http://localhost:8000", "jwt-token", "https://v/1", 0)

        self.assertEqual(call_order, ["timestamped", "request_sent"])


class RunBurstTests(TestCase):
    @patch("scripts.batch_submitter.submit_job")
    def test_submits_exactly_count_jobs(self, mock_submit_job):
        mock_submit_job.side_effect = lambda api_url, token, video_url, index: {
            "index": index,
            "status_code": 201,
            "job_id": index,
            "error": None,
            "accepted_at": "t",
        }

        results = run_burst(
            "http://localhost:8000",
            "jwt-token",
            count=50,
            concurrency=5,
            video_url="https://v/1",
        )

        self.assertEqual(len(results), 50)
        self.assertEqual({r["index"] for r in results}, set(range(50)))

    @patch("scripts.batch_submitter.submit_job")
    def test_never_calls_more_than_concurrency_workers_at_once(self, mock_submit_job):
        import threading
        import time

        in_flight = []
        lock = threading.Lock()
        max_observed = [0]

        def fake_submit(api_url, token, video_url, index):
            with lock:
                in_flight.append(index)
                max_observed[0] = max(max_observed[0], len(in_flight))
            time.sleep(0.01)
            with lock:
                in_flight.remove(index)
            return {
                "index": index,
                "status_code": 201,
                "job_id": index,
                "error": None,
                "accepted_at": "t",
            }

        mock_submit_job.side_effect = fake_submit

        run_burst(
            "http://localhost:8000",
            "jwt-token",
            count=30,
            concurrency=4,
            video_url="https://v/1",
        )

        self.assertLessEqual(max_observed[0], 4)


class WriteResultsTests(TestCase):
    def test_writes_json_list_to_file(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "results.json"
            write_results(path, [{"index": 0, "status_code": 201}])

            written = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(written, [{"index": 0, "status_code": 201}])


class MainTests(TestCase):
    @patch("scripts.batch_submitter.run_burst")
    @patch("scripts.batch_submitter.get_access_token")
    def test_writes_output_and_returns_zero_when_none_rejected(
        self, mock_get_token, mock_run_burst
    ):
        mock_get_token.return_value = "jwt-token"
        mock_run_burst.return_value = [
            {"index": i, "status_code": 201, "job_id": i, "error": None}
            for i in range(3)
        ]

        with TemporaryDirectory() as directory:
            output_path = Path(directory) / "results.json"

            exit_code = main(
                [
                    "--username",
                    "alice",
                    "--password",
                    "secret",
                    "--count",
                    "3",
                    "--output",
                    str(output_path),
                ]
            )

            written = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(written), 3)

    @patch("scripts.batch_submitter.run_burst")
    @patch("scripts.batch_submitter.get_access_token")
    def test_returns_nonzero_when_any_job_rejected(
        self, mock_get_token, mock_run_burst
    ):
        mock_get_token.return_value = "jwt-token"
        mock_run_burst.return_value = [
            {"index": 0, "status_code": 201, "job_id": 0, "error": None},
            {"index": 1, "status_code": 400, "job_id": None, "error": "bad"},
        ]

        exit_code = main(["--username", "alice", "--password", "secret"])

        self.assertEqual(exit_code, 1)
