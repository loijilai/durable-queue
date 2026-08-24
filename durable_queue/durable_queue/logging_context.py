"""JSON structured logging shared by the API and worker processes.

Lives outside the ``jobs`` package (not one of the modules
``scripts/check_architecture.py`` restricts) so it can be imported from both
``jobs.tasks`` and ``jobs.transcribers`` without weakening that boundary.
"""

import contextvars
import json
import logging

# Set by the Celery task_prerun/task_postrun signal handlers so that any log
# line emitted while a job is being processed carries its job id, without
# threading job_id through every function call.
job_id_var = contextvars.ContextVar("job_id", default=None)

_STANDARD_ATTRS = set(
    logging.LogRecord(
        name="", level=0, pathname="", lineno=0, msg="", args=(), exc_info=None
    ).__dict__.keys()
) | {"message", "asctime"}


class JobIdFilter(logging.Filter):
    def filter(self, record):
        if not hasattr(record, "job_id"):
            record.job_id = job_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record):
        payload = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "job_id": getattr(record, "job_id", None),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and key not in payload:
                payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)
