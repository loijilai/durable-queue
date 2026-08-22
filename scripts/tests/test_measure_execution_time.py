import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import MagicMock, patch

from scripts.measure_execution_time import (  # noqa: I001 (sets up sys.path for jobs)
    _append_sample,
    _load_samples,
    main,
    measure,
)

from jobs import transcribers


def _fake_ydl_factory(video_id="test123", ext="webm", duration=60):
    def fake_ydl(options):
        tmp_dir = os.path.dirname(options["outtmpl"])
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

    return fake_ydl


def _fake_ffmpeg_factory(chunk_count=1):
    def fake_run(command, capture_output=True, text=True):
        output_pattern = command[-1]
        tmp_dir = os.path.dirname(output_pattern)
        for index in range(chunk_count):
            chunk_path = os.path.join(tmp_dir, f"chunk_{index:03d}.mp3")
            with open(chunk_path, "wb") as handle:
                handle.write(b"chunk-audio-bytes")
        return MagicMock(returncode=0, stderr="")

    return fake_run


class MeasureTests(TestCase):
    VIDEO_URL = "https://www.youtube.com/watch?v=test123"

    def setUp(self):
        patcher = patch.dict(os.environ, {"OPENAI_API_KEY": "sk-secret"})
        patcher.start()
        self.addCleanup(patcher.stop)

    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_records_phase_timings_and_metadata(
        self, mock_ydl_cls, mock_run, mock_openai_cls
    ):
        # Arrange
        mock_ydl_cls.side_effect = _fake_ydl_factory(duration=125)
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=2)
        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.side_effect = [
            MagicMock(text="first"),
            MagicMock(text="second"),
        ]
        mock_openai_cls.return_value = mock_client

        # Act
        sample = measure(self.VIDEO_URL)

        # Assert
        self.assertEqual(sample["video_url"], self.VIDEO_URL)
        self.assertEqual(sample["video_duration_seconds"], 125)
        self.assertEqual(sample["chunk_count"], 2)
        self.assertGreaterEqual(sample["download_seconds"], 0)
        self.assertGreaterEqual(sample["split_seconds"], 0)
        self.assertGreaterEqual(sample["transcribe_seconds"], 0)
        self.assertAlmostEqual(
            sample["total_seconds"],
            sample["download_seconds"]
            + sample["split_seconds"]
            + sample["transcribe_seconds"],
            places=2,
        )
        self.assertEqual(sample["retryable_errors_encountered"], [])

    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_duration_over_limit_raises_before_split_or_transcribe(
        self, mock_ydl_cls, mock_run, mock_openai_cls
    ):
        mock_ydl_cls.side_effect = _fake_ydl_factory(duration=999999)

        with self.assertRaises(transcribers.PermanentInputError):
            measure(self.VIDEO_URL, max_duration_seconds=100)

        mock_run.assert_not_called()
        mock_openai_cls.return_value.audio.transcriptions.create.assert_not_called()

    @patch("jobs.transcribers.time.sleep")
    @patch("openai.OpenAI")
    @patch("jobs.transcribers.subprocess.run")
    @patch("yt_dlp.YoutubeDL")
    def test_records_retryable_errors_seen_even_when_retry_succeeds(
        self, mock_ydl_cls, mock_run, mock_openai_cls, mock_sleep
    ):
        mock_ydl_cls.side_effect = _fake_ydl_factory(duration=10)
        mock_run.side_effect = _fake_ffmpeg_factory(chunk_count=1)
        mock_client = MagicMock()
        mock_client.audio.transcriptions.create.side_effect = [
            transcribers.TranscriptionRateLimitError("429"),
            MagicMock(text="recovered"),
        ]
        mock_openai_cls.return_value = mock_client

        sample = measure(self.VIDEO_URL)

        self.assertEqual(
            sample["retryable_errors_encountered"], ["TranscriptionRateLimitError"]
        )


class SamplesFileTests(TestCase):
    def test_load_samples_returns_empty_list_when_file_missing(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "samples.json"
            self.assertEqual(_load_samples(path), [])

    def test_append_sample_accumulates_records(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "samples.json"
            _append_sample(path, {"video_url": "a", "total_seconds": 1.0}, "first")
            _append_sample(path, {"video_url": "b", "total_seconds": 2.0}, "second")

            samples = json.loads(path.read_text(encoding="utf-8"))

        self.assertEqual(len(samples), 2)
        self.assertEqual(samples[0]["label"], "first")
        self.assertEqual(samples[1]["label"], "second")


class MainTests(TestCase):
    @patch("scripts.measure_execution_time.measure")
    def test_main_appends_measured_sample_to_samples_file(self, mock_measure):
        mock_measure.return_value = {
            "video_url": "https://youtu.be/abc",
            "video_duration_seconds": 128,
            "chunk_count": 1,
            "download_seconds": 1.0,
            "split_seconds": 0.5,
            "transcribe_seconds": 2.0,
            "total_seconds": 3.5,
            "retryable_errors_encountered": [],
        }
        with TemporaryDirectory() as directory:
            samples_file = Path(directory) / "samples.json"

            exit_code = main(
                [
                    "https://youtu.be/abc",
                    "--label",
                    "2m08s",
                    "--samples-file",
                    str(samples_file),
                ]
            )

            samples = json.loads(samples_file.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(len(samples), 1)
        self.assertEqual(samples[0]["label"], "2m08s")
        self.assertEqual(samples[0]["video_url"], "https://youtu.be/abc")
