from rest_framework import generics
from jobs.serializers import TranscriptionJobSerializer
from jobs.models import TranscriptionJob


# Create your views here.
class JobCreateView(generics.CreateAPIView):
    queryset = TranscriptionJob.objects.all()
    serializer_class = TranscriptionJobSerializer


class JobRetrieveView(generics.RetrieveAPIView):
    queryset = TranscriptionJob.objects.all()
    serializer_class = TranscriptionJobSerializer
