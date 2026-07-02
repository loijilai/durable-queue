from .views import JobCreateView, JobRetrieveView, JobRetryView
from django.urls import path

urlpatterns = [
    path("", JobCreateView.as_view(), name="job-create"),
    path("<int:pk>/", JobRetrieveView.as_view(), name="job-detail"),
    path("<int:job_id>/retry/", JobRetryView.as_view(), name="job-retry"),
]
