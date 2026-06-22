from django.core.management.base import BaseCommand
from jobs.services import mark_failed, mark_succeeded, claim_next_job
from jobs.transcribers import fake_transcribe
import time


class Command(BaseCommand):
    help = "Run a single worker loop"

    def handle(self, *args, **options):
        try:
            while True:

                job = claim_next_job()

                if job is None:
                    time.sleep(1)
                    continue

                try:
                    transcript = fake_transcribe(job.video_url)
                    mark_succeeded(job.id, transcript)
                except Exception as e:
                    try:
                        mark_failed(job.id, str(e))
                    except Exception as mark_err:
                        self.stderr.write(f"mark_failed error: {str(mark_err)}")

        except Exception as e:
            self.stderr.write(f"Unexpected error: {str(e)}")
