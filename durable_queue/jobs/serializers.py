from rest_framework import serializers
from .models import TranscriptionJob
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password


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
            "owner",
        ]
        read_only_fields = [
            "id",
            "status",
            "transcript",
            "error",
            "created_at",
            "finished_at",
            "owner",
        ]


class UserRegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True,
    )

    class Meta:
        model = User
        fields = ["username", "password"]

    def create(self, validated_data):
        return User.objects.create_user(
            **validated_data
        )  # create_user will hash password

    def validate_password(self, value):
        validate_password(value)
        return value
