from rest_framework import serializers
from .models import TranscriptionJob


class TranscriptionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = TranscriptionJob
        fields = [
            "video_url",
            "id",
            "status",
            "transcript",
            "error",
            "created_at",
            "finished_at",
        ]
        read_only_fields = [
            "id",
            "status",
            "transcript",
            "error",
            "created_at",
            "finished_at",
        ]
