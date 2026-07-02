from .models import TranscriptionJob
from django.db import transaction
from django.utils import timezone


def mark_running(job_id):
    with transaction.atomic():
        job = TranscriptionJob.objects.select_for_update().get(pk=job_id)

        if (
            job.status == TranscriptionJob.SUCCEEDED
            or job.status == TranscriptionJob.FAILED
        ):
            return

        job.status = TranscriptionJob.RUNNING

        job.save()
    return job


def mark_succeeded(job_id, transcript):
    with transaction.atomic():
        job = TranscriptionJob.objects.select_for_update().get(pk=job_id)

        if (
            job.status == TranscriptionJob.SUCCEEDED
            or job.status == TranscriptionJob.FAILED
        ):
            return

        if job.status != TranscriptionJob.RUNNING:
            raise ValueError(f"Job status {job.status} cannot be marked as succeeded")

        job.status = TranscriptionJob.SUCCEEDED
        job.transcript = transcript
        job.finished_at = timezone.now()
        job.save()

    return job


def mark_failed(job_id, error):
    with transaction.atomic():
        job = TranscriptionJob.objects.select_for_update().get(pk=job_id)

        if (
            job.status == TranscriptionJob.SUCCEEDED
            or job.status == TranscriptionJob.FAILED
        ):
            return

        if job.status != TranscriptionJob.RUNNING:
            raise ValueError(f"Job status {job.status} cannot be marked as failed")

        job.status = TranscriptionJob.FAILED
        job.error = error
        job.finished_at = timezone.now()
        job.save()

    return job


def retry_job(job_id):
    with transaction.atomic():
        job = TranscriptionJob.objects.select_for_update().get(pk=job_id)

        if job.status != TranscriptionJob.FAILED:
            raise ValueError(f"Job status {job.status} cannot be retried")

        job.status = TranscriptionJob.PENDING
        job.error = None
        job.finished_at = None
        job.save()

    return job
