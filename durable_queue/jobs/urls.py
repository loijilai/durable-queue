from .views import JobCreateView, JobRetrieveView
from django.urls import path

urlpatterns = [
    path("", JobCreateView.as_view(), name="job-create"),
    path("<int:pk>/", JobRetrieveView.as_view(), name="job-create"),
]
