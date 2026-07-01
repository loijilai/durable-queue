from rest_framework import generics
from jobs.serializers import TranscriptionJobSerializer
from jobs.models import TranscriptionJob
from jobs.tasks import execute_job
from django.db import transaction


# Create your views here.
class JobCreateView(generics.CreateAPIView):
    queryset = TranscriptionJob.objects.all()
    serializer_class = TranscriptionJobSerializer

    def perform_create(self, serializer):
        job = serializer.save()
        transaction.on_commit(lambda: execute_job.delay(job.id))


class JobRetrieveView(generics.RetrieveAPIView):
    queryset = TranscriptionJob.objects.all()
    serializer_class = TranscriptionJobSerializer
