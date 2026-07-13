from django.db import models
from django.conf import settings
from django.contrib.auth.models import AbstractUser


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


class CustomUser(AbstractUser):
    email = models.EmailField(unique=True)


class SocialIdentity(models.Model):
    GOOGLE = "google"
    PROVIDER_CHOICES = {
        GOOGLE: "Google",
    }

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="social_identities",
    )
    provider = models.CharField(
        max_length=15, choices=PROVIDER_CHOICES
    )  # 'google' | 'facebook' | ...
    provider_sub = models.CharField(max_length=255)  # Google 給的那個唯一 id
    email = models.EmailField()
    email_verified = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_sub"],
                name="unique_socialidentity_provider_sub",
            )
        ]
