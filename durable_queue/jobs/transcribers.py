import logging
import os
import shutil
import subprocess
import tempfile
import time
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Default chunk length: at 64kbps mono this is ~9.6MB/chunk, comfortably
# under OpenAI's 25MB per-request limit (~2.5x margin).
DEFAULT_CHUNK_SECONDS = 1200
# Bounded per-chunk retry count, mirroring execute_job's max_retries=3. Keeps
# a transient failure on one chunk from forcing a whole-task Celery retry
# that would re-transcribe (and re-bill) already-succeeded chunks.
CHUNK_MAX_ATTEMPTS = 3


class TranscriptionRetryableError(Exception):
    """External failure that Celery should retry."""


class TranscriptionTimeoutError(TranscriptionRetryableError):
    pass


class TranscriptionConnectionError(TranscriptionRetryableError):
    pass


class TranscriptionRateLimitError(TranscriptionRetryableError):
    pass


class TranscriptionPermanentError(Exception):
    """External failure that must not be retried."""


class InvalidMediaError(TranscriptionPermanentError):
    pass


class PermanentInputError(TranscriptionPermanentError):
    pass


class TranscriptionConfigurationError(TranscriptionPermanentError):
    pass


def fake_transcribe(video_url):
    # Split evenly across the three named stages so the sum still matches
    # TRANSCRIBE_SECONDS exactly — burst/capacity experiments (see issue 11)
    # depend on that total, not on how it's divided.
    portion_seconds = int(os.environ["TRANSCRIBE_SECONDS"]) / 3
    for stage in ("download", "reencode", "transcribe"):
        with _stage_timer(stage):
            time.sleep(portion_seconds)
    return "This is a test script"


# yt-dlp folds nearly every failure into DownloadError with a free-text
# message, so classification is keyword-based rather than an exhaustive
# parse of every failure mode. Unrecognized messages default to permanent:
# an unclassified yt-dlp failure is far more often broken/unsupported input
# than transient infrastructure trouble, and retrying it just burns quota.
_RATE_LIMIT_MARKERS = ("429", "too many requests", "rate limit", "rate-limit")
_TIMEOUT_MARKERS = ("timed out", "timeout")
_CONNECTION_MARKERS = (
    "connection",
    "network",
    "temporary failure",
    "reset by peer",
    "name resolution",
)


def _classify_download_error(exc):
    message = str(exc).lower()
    if any(marker in message for marker in _RATE_LIMIT_MARKERS):
        return TranscriptionRateLimitError(str(exc))
    if any(marker in message for marker in _TIMEOUT_MARKERS):
        return TranscriptionTimeoutError(str(exc))
    if any(marker in message for marker in _CONNECTION_MARKERS):
        return TranscriptionConnectionError(str(exc))
    return InvalidMediaError(str(exc))


@contextmanager
def _stage_timer(stage):
    """Logs the stage's duration on success; a failure inside the block
    propagates before the log line, matching how the caller learns of it."""
    start = time.monotonic()
    yield
    logger.info(
        "transcription stage completed",
        extra={"stage": stage, "duration_seconds": time.monotonic() - start},
    )


def _download_audio(video_url, tmp_dir, timeout_seconds):
    import yt_dlp

    options = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(tmp_dir, "%(id)s.%(ext)s"),
        "quiet": True,
        "noprogress": True,
        "no_warnings": True,
        "socket_timeout": timeout_seconds,
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(video_url, download=True)
    except yt_dlp.utils.DownloadError as exc:
        raise _classify_download_error(exc) from exc

    audio_path = ydl.prepare_filename(info)
    if not os.path.exists(audio_path):
        raise InvalidMediaError(
            f"yt-dlp reported success but produced no audio file for {video_url}"
        )
    return audio_path, info.get("duration")


def _split_into_chunks(audio_path, tmp_dir, chunk_seconds):
    """Re-encode to a fixed 64kbps mono bitrate and split into fixed-duration
    chunks in one ffmpeg pass, so each chunk's size is predictable and stays
    well under OpenAI's 25MB per-request limit. Splits are not sentence-aware
    by explicit product decision."""
    command = [
        "ffmpeg",
        "-y",
        "-i",
        audio_path,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        "-f",
        "segment",
        "-segment_time",
        str(chunk_seconds),
        "-reset_timestamps",
        "1",
        os.path.join(tmp_dir, "chunk_%03d.mp3"),
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise TranscriptionConfigurationError(
            "ffmpeg is required to process audio for TRANSCRIBER=real; install "
            "it and make sure it is on PATH."
        ) from exc

    if result.returncode != 0:
        raise InvalidMediaError(
            f"ffmpeg failed to process downloaded audio (exit {result.returncode}): "
            f"{result.stderr[-500:]}"
        )

    chunk_paths = sorted(
        os.path.join(tmp_dir, name)
        for name in os.listdir(tmp_dir)
        if name.startswith("chunk_") and name.endswith(".mp3")
    )
    if not chunk_paths:
        raise InvalidMediaError(
            "ffmpeg produced no audio chunks from the downloaded video."
        )
    return chunk_paths


def _call_openai(audio_path, timeout_seconds):
    import openai

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise TranscriptionConfigurationError(
            "OPENAI_API_KEY is required to use TRANSCRIBER=real. Set it in your "
            "environment or .env file; see durable_queue/.env.example."
        )
    model = os.environ.get("OPENAI_TRANSCRIBE_MODEL", "whisper-1")

    client = openai.OpenAI(api_key=api_key, timeout=timeout_seconds)
    try:
        with open(audio_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(model=model, file=audio_file)
    except openai.RateLimitError as exc:
        raise TranscriptionRateLimitError(str(exc)) from exc
    except openai.APITimeoutError as exc:
        raise TranscriptionTimeoutError(str(exc)) from exc
    except openai.APIConnectionError as exc:
        raise TranscriptionConnectionError(str(exc)) from exc
    except (
        openai.BadRequestError,
        openai.UnprocessableEntityError,
        openai.NotFoundError,
    ) as exc:
        raise InvalidMediaError(str(exc)) from exc
    except (openai.AuthenticationError, openai.PermissionDeniedError) as exc:
        raise TranscriptionConfigurationError(
            "OpenAI rejected the configured credentials; check OPENAI_API_KEY."
        ) from exc
    except openai.APIStatusError as exc:
        if exc.status_code in (500, 502, 503, 504):
            raise TranscriptionConnectionError(str(exc)) from exc
        raise TranscriptionPermanentError(str(exc)) from exc

    return response.text if hasattr(response, "text") else str(response)


def _transcribe_chunk_with_retry(chunk_path, timeout_seconds):
    """Bounded in-process retry for one chunk's retryable failures, so a
    transient blip doesn't force a whole-task Celery retry that re-transcribes
    already-succeeded chunks. Permanent failures propagate immediately."""
    for attempt in range(1, CHUNK_MAX_ATTEMPTS + 1):
        try:
            return _call_openai(chunk_path, timeout_seconds)
        except TranscriptionRetryableError:
            if attempt == CHUNK_MAX_ATTEMPTS:
                raise
            time.sleep(min(2 ** (attempt - 1), 10))


def real_transcribe(video_url):
    timeout_seconds = int(os.environ.get("REAL_TRANSCRIBE_TIMEOUT_SECONDS", "120"))
    max_duration_seconds = int(
        os.environ.get("REAL_TRANSCRIBE_MAX_DURATION_SECONDS", "14400")
    )
    chunk_seconds = int(
        os.environ.get("REAL_TRANSCRIBE_CHUNK_SECONDS", str(DEFAULT_CHUNK_SECONDS))
    )

    tmp_dir = tempfile.mkdtemp(prefix="durable-queue-transcribe-")
    try:
        with _stage_timer("download"):
            audio_path, duration = _download_audio(video_url, tmp_dir, timeout_seconds)

        if duration is not None and duration > max_duration_seconds:
            raise PermanentInputError(
                f"Video duration {duration}s exceeds the configured limit of "
                f"{max_duration_seconds}s."
            )

        with _stage_timer("reencode"):
            chunk_paths = _split_into_chunks(audio_path, tmp_dir, chunk_seconds)

        # All-or-nothing: the first chunk that exhausts its retries or fails
        # permanently raises out of this function with no partial transcript
        # persisted, per the accepted job-model constraint (single transcript
        # field, no new state).
        with _stage_timer("transcribe"):
            transcripts = [
                _transcribe_chunk_with_retry(chunk_path, timeout_seconds)
                for chunk_path in chunk_paths
            ]
        return " ".join(transcripts)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def get_transcriber():
    return {"fake": fake_transcribe, "real": real_transcribe}[os.environ["TRANSCRIBER"]]
