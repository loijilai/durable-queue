from rest_framework import serializers
from .models import TranscriptionJob
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema_field

User = get_user_model()


TRANSCRIPT_PREVIEW_LENGTH = 500


class JobCreateSerializer(serializers.ModelSerializer):
    """建立 Job 的輸入合約：只有 video_url 可寫，其餘欄位由伺服器決定。"""

    class Meta:
        model = TranscriptionJob
        fields = ["video_url"]


class JobRefSerializer(serializers.ModelSerializer):
    """建立 Job 後的最小回應：指出這個 Job 是誰，完整狀態請讀 detail。"""

    class Meta:
        model = TranscriptionJob
        fields = ["id", "status", "created_at"]
        read_only_fields = fields


class JobSummarySerializer(serializers.ModelSerializer):
    """list 的回應：不帶逐字稿全文，只帶一段預覽與長度。"""

    transcript_preview = serializers.SerializerMethodField()
    transcript_length = serializers.SerializerMethodField()

    class Meta:
        model = TranscriptionJob
        fields = [
            "id",
            "video_url",
            "status",
            "error",
            "created_at",
            "finished_at",
            "worker_attempts",
            "transcript_preview",
            "transcript_length",
        ]
        read_only_fields = fields

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_transcript_preview(self, job):
        if job.transcript is None:
            return None
        return job.transcript[:TRANSCRIPT_PREVIEW_LENGTH]

    @extend_schema_field(serializers.IntegerField(allow_null=True))
    def get_transcript_length(self, job):
        if job.transcript is None:
            return None
        return len(job.transcript)


class JobDetailSerializer(serializers.ModelSerializer):
    """detail 的回應：唯一帶逐字稿全文的地方。"""

    class Meta:
        model = TranscriptionJob
        fields = [
            "id",
            "video_url",
            "status",
            "transcript",
            "error",
            "created_at",
            "finished_at",
            "worker_attempts",
        ]
        read_only_fields = fields


class UserRegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True,
    )

    class Meta:
        model = User
        fields = ["username", "password", "email"]

    def create(self, validated_data):
        return User.objects.create_user(
            **validated_data
        )  # create_user will hash password

    def validate_password(self, value):
        validate_password(value)
        return value
