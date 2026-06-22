from .models import TranscriptionJob
from django.db import transaction
from django.db.models import F
from django.utils import timezone


def claim_next_job():
    with transaction.atomic():
        job = (
            TranscriptionJob.objects.filter(status=TranscriptionJob.PENDING)
            .select_for_update(skip_locked=True)
            .order_by("created_at", "id")
            .first()
        )

        if not job:
            return  # 找不到 job 是正常業務分支

        job.claimed_at = timezone.now()
        job.status = TranscriptionJob.RUNNING
        job.attempt_count = F("attempt_count") + 1
        job.save(update_fields=["claimed_at", "status", "attempt_count"])

        job.refresh_from_db()

    return job


def mark_succeeded(job_id, transcript):
    job = TranscriptionJob.objects.get(pk=job_id)

    if job.status != TranscriptionJob.RUNNING:
        raise ValueError("Job status should be running")

    job.status = TranscriptionJob.SUCCEEDED
    job.transcript = transcript
    job.finished_at = timezone.now()
    job.save()

    return job


def mark_failed(job_id, error):
    job = TranscriptionJob.objects.get(pk=job_id)

    if job.status != TranscriptionJob.RUNNING:
        raise ValueError("Job status should be running")

    job.status = TranscriptionJob.FAILED
    job.error = error
    job.finished_at = timezone.now()
    job.save()

    return job


def mark_pending(job_id):
    job = TranscriptionJob.objects.get(pk=job_id)

    if job.status != TranscriptionJob.RUNNING:
        raise ValueError("Job status should be running")

    job.status = TranscriptionJob.PENDING
    job.save()

    return job
