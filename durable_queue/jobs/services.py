from .models import TranscriptionJob
from django.utils import timezone


def claim_next_job():
    # TODO: 目前僅支援單一 worker
    job = (
        TranscriptionJob.objects.filter(status=TranscriptionJob.PENDING)
        .order_by("created_at", "id")
        .first()
    )

    if not job:
        return  # 找不到 job 是正常業務分支

    job.claimed_at = timezone.now()
    job.status = TranscriptionJob.RUNNING
    job.attempt_count += 1
    job.save()

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
