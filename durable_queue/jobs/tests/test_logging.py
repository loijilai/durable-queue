import json
import logging

from django.test import TestCase

from durable_queue.logging_context import JobIdFilter, JsonFormatter, job_id_var


class JsonFormatterTests(TestCase):
    def _make_record(self, **extra):
        record = logging.LogRecord(
            name="jobs.tasks",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="job picked up by worker",
            args=(),
            exc_info=None,
        )
        for key, value in extra.items():
            setattr(record, key, value)
        return record

    def test_output_is_valid_json_with_message_level_and_logger(self):
        record = self._make_record(job_id=42)
        line = JsonFormatter().format(record)

        payload = json.loads(line)
        self.assertEqual(payload["message"], "job picked up by worker")
        self.assertEqual(payload["level"], "INFO")
        self.assertEqual(payload["logger"], "jobs.tasks")

    def test_extra_fields_are_carried_through(self):
        record = self._make_record(
            job_id=42, queue_wait_seconds=3.5, stage="download"
        )
        payload = json.loads(JsonFormatter().format(record))

        self.assertEqual(payload["job_id"], 42)
        self.assertEqual(payload["queue_wait_seconds"], 3.5)
        self.assertEqual(payload["stage"], "download")

    def test_missing_job_id_serializes_as_null(self):
        record = self._make_record()
        payload = json.loads(JsonFormatter().format(record))

        self.assertIsNone(payload["job_id"])


class JobIdFilterTests(TestCase):
    def test_filter_injects_job_id_from_contextvar(self):
        token = job_id_var.set(7)
        try:
            record = logging.LogRecord(
                name="jobs.tasks",
                level=logging.INFO,
                pathname=__file__,
                lineno=1,
                msg="msg",
                args=(),
                exc_info=None,
            )
            JobIdFilter().filter(record)
            self.assertEqual(record.job_id, 7)
        finally:
            job_id_var.reset(token)

    def test_filter_does_not_override_explicit_job_id(self):
        record = logging.LogRecord(
            name="jobs.tasks",
            level=logging.INFO,
            pathname=__file__,
            lineno=1,
            msg="msg",
            args=(),
            exc_info=None,
        )
        record.job_id = 99
        JobIdFilter().filter(record)
        self.assertEqual(record.job_id, 99)
