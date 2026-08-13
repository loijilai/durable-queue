import os
import shutil
import tempfile
import time


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
    time.sleep(int(os.environ["TRANSCRIBE_SECONDS"]))
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


def _download_audio(video_url, tmp_dir, timeout_seconds):
    import yt_dlp

    options = {
        "format": "bestaudio/best",
        "outtmpl": os.path.join(tmp_dir, "%(id)s.%(ext)s"),
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}],
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

    root, _ext = os.path.splitext(ydl.prepare_filename(info))
    audio_path = f"{root}.mp3"
    if not os.path.exists(audio_path):
        raise InvalidMediaError(
            f"yt-dlp reported success but produced no audio file for {video_url}"
        )
    return audio_path, info.get("duration")


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


def real_transcribe(video_url):
    timeout_seconds = int(os.environ.get("REAL_TRANSCRIBE_TIMEOUT_SECONDS", "120"))
    max_duration_seconds = int(
        os.environ.get("REAL_TRANSCRIBE_MAX_DURATION_SECONDS", "1800")
    )

    tmp_dir = tempfile.mkdtemp(prefix="durable-queue-transcribe-")
    try:
        audio_path, duration = _download_audio(video_url, tmp_dir, timeout_seconds)

        if duration is not None and duration > max_duration_seconds:
            raise PermanentInputError(
                f"Video duration {duration}s exceeds the configured limit of "
                f"{max_duration_seconds}s."
            )

        return _call_openai(audio_path, timeout_seconds)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def get_transcriber():
    return {"fake": fake_transcribe, "real": real_transcribe}[os.environ["TRANSCRIBER"]]
