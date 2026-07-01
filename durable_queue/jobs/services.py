from .models import TranscriptionJob
from django.db import transaction
from django.utils import timezone


def mark_running(job_id):
    with transaction.atomic():
        job = TranscriptionJob.objects.select_for_update().get(pk=job_id)

        if job.status == TranscriptionJob.RUNNING:
            return job

        job.status = TranscriptionJob.RUNNING
        job.claimed_at = timezone.now()

        job.save()
    return job


def mark_succeeded(job_id, transcript):
    with transaction.atomic():
        job = TranscriptionJob.objects.select_for_update().get(pk=job_id)

        if job.status == TranscriptionJob.SUCCEEDED:
            return

        if job.status != TranscriptionJob.RUNNING:
            raise ValueError(f"Job status {job.status} cannot be marked succeeded")

        job.status = TranscriptionJob.SUCCEEDED
        job.transcript = transcript
        job.finished_at = timezone.now()
        job.save()

    return job


def mark_failed(job_id, error):
    with transaction.atomic():
        job = TranscriptionJob.objects.select_for_update().get(pk=job_id)

        if job.status == TranscriptionJob.FAILED:
            return

        if job.status != TranscriptionJob.RUNNING:
            raise ValueError("Job status should be running")

        job.status = TranscriptionJob.FAILED
        job.error = error
        job.finished_at = timezone.now()
        job.save()

    return job
