import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from scripts.analyze_execution_time import (
    fit_linear_model,
    load_samples,
    main,
    phase_shares,
    rate_limit_observations,
    render_report,
)


def _sample(duration, download, split, transcribe, label=None, errors=None):
    total = download + split + transcribe
    return {
        "label": label,
        "video_url": f"https://youtu.be/{duration}",
        "video_duration_seconds": duration,
        "chunk_count": 1,
        "download_seconds": download,
        "split_seconds": split,
        "transcribe_seconds": transcribe,
        "total_seconds": total,
        "retryable_errors_encountered": errors or [],
    }


class LoadSamplesTests(TestCase):
    def test_raises_when_file_missing(self):
        with TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                load_samples(Path(directory) / "missing.json")

    def test_raises_when_file_is_empty_list(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "samples.json"
            path.write_text("[]", encoding="utf-8")
            with self.assertRaises(ValueError):
                load_samples(path)


class FitLinearModelTests(TestCase):
    def test_recovers_exact_line_from_noiseless_samples(self):
        # a=10, b=2 exactly: total = 10 + 2 * duration
        samples = [
            _sample(duration, 0, 0, 10 + 2 * duration)
            for duration in (100, 200, 400, 800)
        ]

        a, b = fit_linear_model(samples)

        self.assertAlmostEqual(a, 10, places=6)
        self.assertAlmostEqual(b, 2, places=6)

    def test_raises_with_fewer_than_two_samples(self):
        with self.assertRaises(ValueError):
            fit_linear_model([_sample(100, 1, 1, 1)])

    def test_raises_when_all_durations_identical(self):
        samples = [_sample(100, 1, 1, 1), _sample(100, 2, 2, 2)]
        with self.assertRaises(ValueError):
            fit_linear_model(samples)


class PhaseSharesTests(TestCase):
    def test_averages_each_samples_own_share(self):
        # sample 1: 50/25/25 split; sample 2: 25/25/50 split -> average 37.5/25/37.5
        samples = [
            _sample(100, 5, 2.5, 2.5),
            _sample(1000, 25, 25, 50),
        ]

        shares = phase_shares(samples)

        self.assertAlmostEqual(shares["download"], 0.375, places=6)
        self.assertAlmostEqual(shares["split"], 0.25, places=6)
        self.assertAlmostEqual(shares["transcribe"], 0.375, places=6)


class RateLimitObservationsTests(TestCase):
    def test_reports_samples_with_rate_limit_errors(self):
        samples = [
            _sample(100, 1, 1, 1, label="short"),
            _sample(
                2000,
                1,
                1,
                1,
                label="long",
                errors=["TranscriptionRateLimitError", "TranscriptionRateLimitError"],
            ),
        ]

        observations = rate_limit_observations(samples)

        self.assertEqual(len(observations), 1)
        self.assertIn("long", observations[0])
        self.assertIn("2x", observations[0])

    def test_empty_when_no_rate_limit_errors_seen(self):
        samples = [_sample(100, 1, 1, 1)]
        self.assertEqual(rate_limit_observations(samples), [])


class RenderReportTests(TestCase):
    def test_report_includes_sample_count_model_and_projection(self):
        samples = [_sample(100, 1, 1, 1, label="a"), _sample(200, 2, 2, 2, label="b")]
        report = render_report(
            samples,
            a=0.0,
            b=0.03,
            shares={"download": 1 / 3, "split": 1 / 3, "transcribe": 1 / 3},
            admission_limit_seconds=14400,
        )

        self.assertIn("Sample count: 2", report)
        self.assertIn("Execution Time ≈ 0.000 + 0.030000", report)
        self.assertIn("Admission Limit", report)
        self.assertIn("No TranscriptionRateLimitError was observed", report)

    def test_report_surfaces_rate_limit_observations_when_present(self):
        samples = [
            _sample(100, 1, 1, 1, label="a"),
            _sample(
                200, 2, 2, 2, label="b", errors=["TranscriptionRateLimitError"]
            ),
        ]
        report = render_report(
            samples,
            a=0.0,
            b=0.03,
            shares={"download": 1 / 3, "split": 1 / 3, "transcribe": 1 / 3},
            admission_limit_seconds=14400,
        )

        self.assertIn("was observed during this measurement run", report)
        self.assertIn("b: rate limit hit (1x)", report)


class MainTests(TestCase):
    def test_writes_report_file_from_samples(self):
        with TemporaryDirectory() as directory:
            samples_file = Path(directory) / "samples.json"
            output_file = Path(directory) / "results.md"
            samples = [
                _sample(100, 1, 1, 1, label="a"),
                _sample(200, 2, 2, 2, label="b"),
            ]
            samples_file.write_text(json.dumps(samples), encoding="utf-8")

            exit_code = main(
                [
                    "--samples-file",
                    str(samples_file),
                    "--output",
                    str(output_file),
                ]
            )

            content = output_file.read_text(encoding="utf-8")

        self.assertEqual(exit_code, 0)
        self.assertIn("Execution Time measurement results", content)
        self.assertIn("Sample count: 2", content)
