from rest_framework import generics
from jobs.serializers import TranscriptionJobSerializer, UserRegisterSerializer
from jobs.models import TranscriptionJob
from jobs.tasks import execute_job
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from jobs.services import retry_job
from django.http import Http404
from drf_spectacular.utils import extend_schema, OpenApiResponse
from rest_framework.permissions import AllowAny
from django.shortcuts import get_object_or_404


# Create your views here.
class JobCreateView(generics.ListCreateAPIView):
    serializer_class = TranscriptionJobSerializer

    def get_queryset(self):
        return TranscriptionJob.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        job = serializer.save(owner=self.request.user)
        execute_job.delay(job.id)


class JobRetrieveView(generics.RetrieveAPIView):
    serializer_class = TranscriptionJobSerializer

    def get_queryset(self):
        return TranscriptionJob.objects.filter(owner=self.request.user)


class JobRetryView(APIView):
    @extend_schema(
        request=None,
        responses={
            202: TranscriptionJobSerializer,
            404: OpenApiResponse(description="not found"),
            409: OpenApiResponse(description="job is not in failed status"),
        },
        description="Retry endpoint for Failed job",
    )
    def post(self, request, job_id):
        get_object_or_404(TranscriptionJob, id=job_id, owner=request.user)
        try:
            job = retry_job(job_id)
            execute_job.delay(job_id)  # dispatch 必定在 DB commit 後，此處需要順序保證
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        except TranscriptionJob.DoesNotExist:
            raise Http404

        serializer = TranscriptionJobSerializer(job)
        return Response(serializer.data, status=status.HTTP_202_ACCEPTED)


# Authentication
class UserRegisterView(generics.CreateAPIView):
    permission_classes = [AllowAny]
    serializer_class = UserRegisterSerializer
