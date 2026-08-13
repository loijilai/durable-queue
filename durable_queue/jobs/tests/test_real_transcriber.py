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


class RealTranscribeSuccessTests(TestCase):
    VIDEO_URL = "https://www.youtube.com/watch?v=test123"
    TRANSCRIPT = "hello world"

    def setUp(self):
        patcher = patch.dict(os.environ, {"OPENAI_API_KEY": "sk-secret-value"})
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("openai.OpenAI")
    @patch("yt_dlp.YoutubeDL")
    def test_downloads_transcribes_and_cleans_up(self, mock_ydl_cls, mock_openai_cls):
        # Arrange
        recorded_tmp_dirs = []

        def fake_ydl(options):
            recorded_tmp_dirs.append(os.path.dirname(options["outtmpl"]))
            instance = MagicMock()
            instance.__enter__.return_value = instance
            instance.__exit__.return_value = False
            instance.extract_info.return_value = {"id": "test123", "duration": 60}
            audio_path = os.path.join(
                os.path.dirname(options["outtmpl"]), "test123.mp3"
            )
            instance.prepare_filename.return_value = audio_path
            with open(audio_path, "wb") as handle:
                handle.write(b"fake-audio-bytes")
            return instance

        mock_ydl_cls.side_effect = fake_ydl

        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.return_value = MagicMock(
            text=self.TRANSCRIPT
        )
        mock_openai_cls.return_value = mock_client

        # Act
        result = transcribers.real_transcribe(self.VIDEO_URL)

        # Assert
        self.assertEqual(result, self.TRANSCRIPT)
        self.assertEqual(len(recorded_tmp_dirs), 1)
        self.assertFalse(os.path.exists(recorded_tmp_dirs[0]))

    @patch("openai.OpenAI")
    @patch("yt_dlp.YoutubeDL")
    def test_duration_over_limit_is_permanent_and_skips_openai(
        self, mock_ydl_cls, mock_openai_cls
    ):
        # Arrange
        recorded_tmp_dirs = []

        def fake_ydl(options):
            recorded_tmp_dirs.append(os.path.dirname(options["outtmpl"]))
            instance = MagicMock()
            instance.__enter__.return_value = instance
            instance.__exit__.return_value = False
            instance.extract_info.return_value = {"id": "test123", "duration": 999999}
            audio_path = os.path.join(
                os.path.dirname(options["outtmpl"]), "test123.mp3"
            )
            instance.prepare_filename.return_value = audio_path
            with open(audio_path, "wb") as handle:
                handle.write(b"fake-audio-bytes")
            return instance

        mock_ydl_cls.side_effect = fake_ydl
        mock_openai_cls.return_value = MagicMock()

        # Act / Assert
        with self.assertRaises(transcribers.PermanentInputError):
            transcribers.real_transcribe(self.VIDEO_URL)

        mock_openai_cls.return_value.audio.transcriptions.create.assert_not_called()
        self.assertFalse(os.path.exists(recorded_tmp_dirs[0]))


class RealTranscribeConfigTests(TestCase):
    VIDEO_URL = "https://www.youtube.com/watch?v=test123"

    @patch("openai.OpenAI")
    @patch("yt_dlp.YoutubeDL")
    def test_missing_api_key_fails_permanently_without_calling_openai(
        self, mock_ydl_cls, mock_openai_cls
    ):
        # Arrange
        os.environ.pop("OPENAI_API_KEY", None)

        def fake_ydl(options):
            instance = MagicMock()
            instance.__enter__.return_value = instance
            instance.__exit__.return_value = False
            instance.extract_info.return_value = {"id": "test123", "duration": 5}
            audio_path = os.path.join(
                os.path.dirname(options["outtmpl"]), "test123.mp3"
            )
            instance.prepare_filename.return_value = audio_path
            with open(audio_path, "wb") as handle:
                handle.write(b"fake-audio-bytes")
            return instance

        mock_ydl_cls.side_effect = fake_ydl

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
            transcribers.real_transcribe(self.VIDEO_URL)

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
                transcribers.real_transcribe(self.VIDEO_URL)

        self.assertFalse(os.path.exists(captured["tmp_dir"]))


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

        ydl_patcher = patch("yt_dlp.YoutubeDL")
        self.mock_ydl_cls = ydl_patcher.start()
        self.addCleanup(ydl_patcher.stop)

        def fake_ydl(options):
            instance = MagicMock()
            instance.__enter__.return_value = instance
            instance.__exit__.return_value = False
            instance.extract_info.return_value = {"id": "test123", "duration": 5}
            audio_path = os.path.join(
                os.path.dirname(options["outtmpl"]), "test123.mp3"
            )
            instance.prepare_filename.return_value = audio_path
            with open(audio_path, "wb") as handle:
                handle.write(b"fake-audio-bytes")
            return instance

        self.mock_ydl_cls.side_effect = fake_ydl

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
