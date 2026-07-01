from django.core.management.base import BaseCommand
from jobs.services import mark_failed, mark_succeeded, mark_pending, claim_next_job
from jobs.transcribers import fake_transcribe
from jobs.models import TranscriptionJob
import time

ATTEMPT_LIMIT = 3


class Command(BaseCommand):
    help = "Run a worker loop"

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
                    # TODO: 區分可重試（transient，如 API 暫時錯誤）與不可重試（permanent，如 video_url 格式錯誤）的錯誤，
                    # 不可重試的錯誤應該直接 mark_failed，不要浪費 attempt_count
                    # TODO: 固定 sleep(1) 不是真正的 backoff，之後要換成 exponential backoff + jitter
                    if job.attempt_count < ATTEMPT_LIMIT:
                        mark_pending(job.id)
                        time.sleep(1)
                        continue
                    try:
                        mark_failed(job.id, str(e))
                    except Exception as mark_err:
                        self.stderr.write(f"mark_failed error: {str(mark_err)}")

        except Exception as e:
            self.stderr.write(f"Unexpected error: {str(e)}")
