import os
from unittest import TestCase
from unittest.mock import MagicMock, patch

import httpx2
import openai
import yt_dlp

from jobs import transcribers


def _make_response(status_code):
    request = httpx2.Request("POST", "https://api.openai.com/v1/audio/transcriptions")
    return httpx2.Response(status_code, request=request)


def _make_request():
    return httpx2.Request("POST", "https://api.openai.com/v1/audio/transcriptions")


def _fake_ydl_factory(video_id="test123", ext="webm", duration=60):
    """Builds a yt_dlp.YoutubeDL side_effect that writes a raw placeholder
    audio file and returns metadata matching what real_transcribe reads."""
    recorded_tmp_dirs = []

    def fake_ydl(options):
        tmp_dir = os.path.dirname(options["outtmpl"])
        recorded_tmp_dirs.append(tmp_dir)
        instance = MagicMock()
        instance.__enter__.return_value = instance
        instance.__exit__.return_value = False
        info = {"id": video_id, "ext": ext, "duration": duration}
        instance.extract_info.return_value = info
        audio_path = os.path.join(tmp_dir, f"{video_id}.{ext}")
        instance.prepare_filename.return_value = audio_path
        with open(audio_path, "wb") as handle:
            handle.write(b"raw-audio-bytes")
        return instance

    return fake_ydl, recorded_tmp_dirs


def _fake_ffmpeg_factory(chunk_count=1):
    """Builds a subprocess.run side_effect that creates `chunk_count` fake
    chunk files in the same directory as the ffmpeg output pattern arg."""

    def fake_run(command, capture_output=True, text=True):
        output_pattern = command[-1]
        tmp_dir = os.path.dirname(output_pattern)
        for index in range(chunk_count):
            chunk_path = os.path.join(tmp_dir, f"chunk_{index:03d}.mp3")
            with open(chunk_path, "wb") as handle:
                handle.write(b"chunk-audio-bytes")
        return MagicMock(returncode=0, stderr="")

    return fake_run


class RealTranscribeSuccessTests(TestCase):
    VIDEO_URL = "https://www.youtube.com/watch?v=test123"

    def setUp(self):
        patcher = patch.dict(os.environ, {"OPENAI_API_KEY": "sk-secret-value"})
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_downloads_splits_transcribes_and_cleans_up(
        self, mock_ydl_cls, mock_run, mock_openai_cls
    ):
        # Arrange
        fake_ydl, recorded_tmp_dirs = _fake_ydl_factory(duration=3600)
        mock_ydl_cls.side_effect = fake_ydl
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=3)

        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.side_effect = [
            MagicMock(text="first"),
            MagicMock(text="second"),
            MagicMock(text="third"),
        ]
        mock_openai_cls.return_value = mock_client

        # Act
        result = transcribers.real_transcribe(self.VIDEO_URL)

        # Assert
        self.assertEqual(result, "first second third")
        self.assertEqual(mock_client.audio.transcriptions.create.call_count, 3)
        self.assertEqual(len(recorded_tmp_dirs), 1)
        self.assertFalse(os.path.exists(recorded_tmp_dirs[0]))

    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_duration_over_limit_is_permanent_and_skips_ffmpeg_and_openai(
        self, mock_ydl_cls, mock_run, mock_openai_cls
    ):
        # Arrange
        fake_ydl, recorded_tmp_dirs = _fake_ydl_factory(duration=999999)
        mock_ydl_cls.side_effect = fake_ydl
        mock_openai_cls.return_value = MagicMock()

        # Act / Assert
        with self.assertRaises(transcribers.PermanentInputError):
            transcribers.real_transcribe(self.VIDEO_URL)

        mock_run.assert_not_called()
        mock_openai_cls.return_value.audio.transcriptions.create.assert_not_called()
        self.assertFalse(os.path.exists(recorded_tmp_dirs[0]))

    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_permanent_chunk_failure_stops_remaining_chunks_all_or_nothing(
        self, mock_ydl_cls, mock_run, mock_openai_cls
    ):
        # Arrange
        fake_ydl, recorded_tmp_dirs = _fake_ydl_factory(duration=3600)
        mock_ydl_cls.side_effect = fake_ydl
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=3)

        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.side_effect = [
            MagicMock(text="first"),
            openai.BadRequestError(
                "bad chunk", response=_make_response(400), body=None
            ),
            MagicMock(text="third"),
        ]
        mock_openai_cls.return_value = mock_client

        # Act / Assert
        with self.assertRaises(transcribers.InvalidMediaError):
            transcribers.real_transcribe(self.VIDEO_URL)

        # Only the first (succeeded) and second (failed) chunks were attempted.
        self.assertEqual(mock_client.audio.transcriptions.create.call_count, 2)
        self.assertFalse(os.path.exists(recorded_tmp_dirs[0]))

    @patch("jobs.transcribers.time.sleep")
    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_chunk_retries_transient_failure_before_succeeding(
        self, mock_ydl_cls, mock_run, mock_openai_cls, mock_sleep
    ):
        # Arrange
        fake_ydl, _ = _fake_ydl_factory(duration=600)
        mock_ydl_cls.side_effect = fake_ydl
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=1)

        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.side_effect = [
            openai.APITimeoutError(_make_request()),
            MagicMock(text="recovered"),
        ]
        mock_openai_cls.return_value = mock_client

        # Act
        result = transcribers.real_transcribe(self.VIDEO_URL)

        # Assert
        self.assertEqual(result, "recovered")
        self.assertEqual(mock_client.audio.transcriptions.create.call_count, 2)
        mock_sleep.assert_called_once()

    @patch("jobs.transcribers.time.sleep")
    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_chunk_exhausts_retries_then_fails_job(
        self, mock_ydl_cls, mock_run, mock_openai_cls, mock_sleep
    ):
        # Arrange
        fake_ydl, _ = _fake_ydl_factory(duration=600)
        mock_ydl_cls.side_effect = fake_ydl
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=1)

        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.side_effect = openai.APITimeoutError(
            _make_request()
        )
        mock_openai_cls.return_value = mock_client

        # Act / Assert
        with self.assertRaises(transcribers.TranscriptionTimeoutError):
            transcribers.real_transcribe(self.VIDEO_URL)

        self.assertEqual(
            mock_client.audio.transcriptions.create.call_count,
            transcribers.CHUNK_MAX_ATTEMPTS,
        )

    @patch("openai.OpenAI")
    @patch("yt_dlp.YoutubeDL")
    def test_ffmpeg_failure_is_permanent_and_cleans_up(
        self, mock_ydl_cls, mock_openai_cls
    ):
        # Arrange
        fake_ydl, recorded_tmp_dirs = _fake_ydl_factory(duration=60)
        mock_ydl_cls.side_effect = fake_ydl

        def failing_run(command, capture_output=True, text=True):
            return MagicMock(returncode=1, stderr="Invalid data found")

        # Act / Assert
        with patch("jobs.transcribers.subprocess.run", side_effect=failing_run):
            with self.assertRaises(transcribers.InvalidMediaError):
                transcribers.real_transcribe(self.VIDEO_URL)

        mock_openai_cls.assert_not_called()
        self.assertFalse(os.path.exists(recorded_tmp_dirs[0]))

    @patch("openai.OpenAI")
    @patch("yt_dlp.YoutubeDL")
    def test_missing_ffmpeg_binary_is_configuration_error(
        self, mock_ydl_cls, mock_openai_cls
    ):
        # Arrange
        fake_ydl, recorded_tmp_dirs = _fake_ydl_factory(duration=60)
        mock_ydl_cls.side_effect = fake_ydl

        # Act / Assert
        with patch(
            "jobs.transcribers.subprocess.run", side_effect=FileNotFoundError()
        ):
            with self.assertRaises(transcribers.TranscriptionConfigurationError):
                transcribers.real_transcribe(self.VIDEO_URL)

        mock_openai_cls.assert_not_called()
        self.assertFalse(os.path.exists(recorded_tmp_dirs[0]))


class RealTranscribeConfigTests(TestCase):
    VIDEO_URL = "https://www.youtube.com/watch?v=test123"

    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_missing_api_key_fails_permanently_without_calling_openai(
        self, mock_ydl_cls, mock_run, mock_openai_cls
    ):
        # Arrange
        os.environ.pop("OPENAI_API_KEY", None)
        fake_ydl, _ = _fake_ydl_factory(duration=5)
        mock_ydl_cls.side_effect = fake_ydl
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=1)

        # Act / Assert
        with self.assertRaises(transcribers.TranscriptionConfigurationError) as ctx:
            transcribers.real_transcribe(self.VIDEO_URL)

        self.assertIn("OPENAI_API_KEY", str(ctx.exception))
        mock_openai_cls.assert_not_called()

    @patch.dict(os.environ, {"OPENAI_API_KEY": "sk-do-not-leak-me"})
    @patch("yt_dlp.YoutubeDL")
    def test_secret_never_appears_in_raised_error(self, mock_ydl_cls):
        # Arrange
        mock_ydl_cls.side_effect = yt_dlp.utils.DownloadError("Video unavailable")

        # Act / Assert
        with self.assertRaises(transcribers.InvalidMediaError) as ctx:
            transcribers.real_transcribe("https://www.youtube.com/watch?v=test123")

        self.assertNotIn("sk-do-not-leak-me", str(ctx.exception))

    @patch.dict(os.environ, {"OPENAI_API_KEY": "sk-secret"})
    @patch("yt_dlp.YoutubeDL")
    def test_temp_dir_cleaned_up_on_download_failure(self, mock_ydl_cls):
        # Arrange
        captured = {}
        original_mkdtemp = transcribers.tempfile.mkdtemp

        def spy_mkdtemp(*args, **kwargs):
            path = original_mkdtemp(*args, **kwargs)
            captured["tmp_dir"] = path
            return path

        mock_ydl_cls.side_effect = yt_dlp.utils.DownloadError("Connection reset by peer")

        with patch("jobs.transcribers.tempfile.mkdtemp", side_effect=spy_mkdtemp):
            # Act / Assert
            with self.assertRaises(transcribers.TranscriptionConnectionError):
                transcribers.real_transcribe("https://www.youtube.com/watch?v=test123")

        self.assertFalse(os.path.exists(captured["tmp_dir"]))


class SplitIntoChunksTests(TestCase):
    def setUp(self):
        import shutil
        import tempfile

        self.tmp_dir = tempfile.mkdtemp(prefix="test-split-into-chunks-")
        self.addCleanup(shutil.rmtree, self.tmp_dir, True)
        self.source_path = os.path.join(self.tmp_dir, "source.webm")
        with open(self.source_path, "wb") as handle:
            handle.write(b"raw-audio-bytes")

    def test_chunk_count_matches_ffmpeg_output(self):
        with patch(
            "jobs.transcribers.subprocess.run",
            side_effect=_fake_ffmpeg_factory(chunk_count=5),
        ):
            chunk_paths = transcribers._split_into_chunks(
                self.source_path, self.tmp_dir, 1200
            )
        self.assertEqual(len(chunk_paths), 5)
        self.assertEqual(chunk_paths, sorted(chunk_paths))

    def test_no_chunks_produced_is_permanent(self):
        def no_op_run(command, capture_output=True, text=True):
            return MagicMock(returncode=0, stderr="")

        with patch("jobs.transcribers.subprocess.run", side_effect=no_op_run):
            with self.assertRaises(transcribers.InvalidMediaError):
                transcribers._split_into_chunks(self.source_path, self.tmp_dir, 1200)


class DownloadErrorClassificationTests(TestCase):
    def test_rate_limit_marker_is_retryable(self):
        exc = transcribers._classify_download_error(
            yt_dlp.utils.DownloadError("HTTP Error 429: Too Many Requests")
        )
        self.assertIsInstance(exc, transcribers.TranscriptionRateLimitError)

    def test_timeout_marker_is_retryable(self):
        exc = transcribers._classify_download_error(
            yt_dlp.utils.DownloadError("Connection timed out")
        )
        self.assertIsInstance(exc, transcribers.TranscriptionTimeoutError)

    def test_connection_marker_is_retryable(self):
        exc = transcribers._classify_download_error(
            yt_dlp.utils.DownloadError("Temporary failure in name resolution")
        )
        self.assertIsInstance(exc, transcribers.TranscriptionConnectionError)

    def test_unrecognized_message_is_permanent(self):
        exc = transcribers._classify_download_error(
            yt_dlp.utils.DownloadError("Private video")
        )
        self.assertIsInstance(exc, transcribers.InvalidMediaError)


class OpenAIErrorMappingTests(TestCase):
    VIDEO_URL = "https://www.youtube.com/watch?v=test123"

    def setUp(self):
        patcher = patch.dict(os.environ, {"OPENAI_API_KEY": "sk-secret"})
        patcher.start()
        self.addCleanup(patcher.stop)

        sleep_patcher = patch("jobs.transcribers.time.sleep")
        sleep_patcher.start()
        self.addCleanup(sleep_patcher.stop)

        ydl_patcher = patch("yt_dlp.YoutubeDL")
        mock_ydl_cls = ydl_patcher.start()
        self.addCleanup(ydl_patcher.stop)
        fake_ydl, _ = _fake_ydl_factory(duration=5)
        mock_ydl_cls.side_effect = fake_ydl

        run_patcher = patch("jobs.transcribers.subprocess.run")
        mock_run = run_patcher.start()
        self.addCleanup(run_patcher.stop)
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=1)

        openai_patcher = patch("openai.OpenAI")
        self.mock_openai_cls = openai_patcher.start()
        self.addCleanup(openai_patcher.stop)
        self.mock_client = MagicMock()
        self.mock_openai_cls.return_value = self.mock_client

    def _run_and_expect(self, exc, expected_type):
        self.mock_client.audio.transcriptions.create.side_effect = exc
        with self.assertRaises(expected_type):
            transcribers.real_transcribe(self.VIDEO_URL)

    def test_rate_limit_is_retryable(self):
        self._run_and_expect(
            openai.RateLimitError(
                "rate limited", response=_make_response(429), body=None
            ),
            transcribers.TranscriptionRateLimitError,
        )

    def test_timeout_is_retryable(self):
        self._run_and_expect(
            openai.APITimeoutError(_make_request()),
            transcribers.TranscriptionTimeoutError,
        )

    def test_connection_error_is_retryable(self):
        self._run_and_expect(
            openai.APIConnectionError(request=_make_request()),
            transcribers.TranscriptionConnectionError,
        )

    def test_bad_request_is_invalid_media(self):
        self._run_and_expect(
            openai.BadRequestError(
                "unsupported format", response=_make_response(400), body=None
            ),
            transcribers.InvalidMediaError,
        )

    def test_authentication_error_is_configuration_error(self):
        self._run_and_expect(
            openai.AuthenticationError(
                "invalid api key", response=_make_response(401), body=None
            ),
            transcribers.TranscriptionConfigurationError,
        )

    def test_server_error_is_retryable(self):
        self._run_and_expect(
            openai.InternalServerError(
                "server error", response=_make_response(503), body=None
            ),
            transcribers.TranscriptionConnectionError,
        )

    def test_authentication_error_message_never_contains_secret(self):
        self.mock_client.audio.transcriptions.create.side_effect = (
            openai.AuthenticationError(
                "invalid api key sk-secret", response=_make_response(401), body=None
            )
        )
        with self.assertRaises(transcribers.TranscriptionConfigurationError) as ctx:
            transcribers.real_transcribe(self.VIDEO_URL)
        self.assertNotIn("sk-secret", str(ctx.exception))


class GetTranscriberSelectionTests(TestCase):
    def test_selects_fake_transcribe(self):
        with patch.dict(os.environ, {"TRANSCRIBER": "fake"}):
            self.assertIs(transcribers.get_transcriber(), transcribers.fake_transcribe)

    def test_selects_real_transcribe(self):
        with patch.dict(os.environ, {"TRANSCRIBER": "real"}):
            self.assertIs(transcribers.get_transcriber(), transcribers.real_transcribe)

    def test_invalid_value_fails_fast(self):
        with patch.dict(os.environ, {"TRANSCRIBER": "not-a-real-choice"}):
            with self.assertRaises(KeyError):
                transcribers.get_transcriber()
