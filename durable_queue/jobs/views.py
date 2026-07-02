from rest_framework import generics
from jobs.serializers import TranscriptionJobSerializer
from jobs.models import TranscriptionJob
from jobs.tasks import execute_job
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from jobs.services import retry_job
from django.http import Http404


# Create your views here.
class JobCreateView(generics.CreateAPIView):
    queryset = TranscriptionJob.objects.all()
    serializer_class = TranscriptionJobSerializer

    def perform_create(self, serializer):
        job = serializer.save()
        execute_job.delay(job.id)


class JobRetrieveView(generics.RetrieveAPIView):
    queryset = TranscriptionJob.objects.all()
    serializer_class = TranscriptionJobSerializer


class JobRetryView(APIView):
    def post(self, request, job_id):
        try:
            job = retry_job(job_id)
            execute_job.delay(job_id)  # dispatch 必定在 DB commit 後，此處需要順序保證
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_409_CONFLICT)
        except TranscriptionJob.DoesNotExist:
            raise Http404

        serializer = TranscriptionJobSerializer(job)
        return Response(serializer.data, status=status.HTTP_202_ACCEPTED)
