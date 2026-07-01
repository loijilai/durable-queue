from django.db import models


# Create your models here.
class TranscriptionJob(models.Model):
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    STATUS_CHOICES = {
        PENDING: "Pending",
        RUNNING: "Running",
        SUCCEEDED: "Succeeded",
        FAILED: "Failed",
    }
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    video_url = models.URLField(max_length=200)

    transcript = models.TextField(null=True)
    error = models.TextField(null=True)
    attempt_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    claimed_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
