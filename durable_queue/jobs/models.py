from django.db import models
from django.conf import settings


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
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    transcript = models.TextField(null=True)
    error = models.TextField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True)
