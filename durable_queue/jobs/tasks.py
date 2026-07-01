from celery import Task, shared_task
from jobs.services import mark_running, mark_succeeded, mark_failed
from jobs.transcribers import fake_transcribe


class ExecuteJobTask(Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        job_id = args[0]
        mark_failed(job_id, str(exc))

        super().on_failure(exc, task_id, args, kwargs, einfo)


@shared_task(
    base=ExecuteJobTask,
    autoretry_for=(ConnectionError, TimeoutError),
    max_retries=3,
    retry_backoff=True,
    retry_jitter=True,
)
def execute_job(job_id):
    job = mark_running(job_id)
    transcript = fake_transcribe(job.video_url)
    mark_succeeded(job.id, transcript)
