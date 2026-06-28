from django.core.management.base import BaseCommand
from jobs.services import reclaim_job
from jobs.models import TranscriptionJob
from django.utils import timezone
import time


class Command(BaseCommand):
    help = "Run a sweeper"

    def handle(self, *args, **options):
        while True:
            try:
                reclaim_job()
            except Exception as e:
                self.stderr.write(f"Sweeper unexpected error: {str(e)}")
            finally:
                time.sleep(5)
