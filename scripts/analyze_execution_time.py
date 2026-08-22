#!/usr/bin/env python3
"""Fits the Execution Time model from samples recorded by
scripts/measure_execution_time.py and writes the ticket's report.

    python3 scripts/analyze_execution_time.py

Reads issues/scaling-control-loop/execution-time-samples.json and writes
issues/scaling-control-loop/02-measure-execution-time-results.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SAMPLES_FILE = (
    ROOT / "issues" / "scaling-control-loop" / "execution-time-samples.json"
)
DEFAULT_OUTPUT = (
    ROOT / "issues" / "scaling-control-loop" / "02-measure-execution-time-results.md"
)
# jobs/.env.example's REAL_TRANSCRIBE_MAX_DURATION_SECONDS default: the
# admission gate past which a video is rejected as PermanentInputError.
DEFAULT_ADMISSION_LIMIT_SECONDS = 14400


def load_samples(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"No samples file at {path}. Run scripts/measure_execution_time.py "
            "for each video first."
        )
    samples = json.loads(path.read_text(encoding="utf-8"))
    if not samples:
        raise ValueError(f"{path} has no samples yet.")
    return samples


def fit_linear_model(samples: list[dict]) -> tuple[float, float]:
    """Ordinary least squares closed form for Execution Time ≈ a + b ×
    duration. Two unknowns from two sums — no numpy/scipy dependency
    needed."""
    n = len(samples)
    if n < 2:
        raise ValueError("Need at least 2 samples to fit a line.")
    xs = [s["video_duration_seconds"] for s in samples]
    ys = [s["total_seconds"] for s in samples]
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denominator = sum((x - mean_x) ** 2 for x in xs)
    if denominator == 0:
        raise ValueError("All sampled durations are identical; cannot fit a slope.")
    b = numerator / denominator
    a = mean_y - b * mean_x
    return a, b


def phase_shares(samples: list[dict]) -> dict[str, float]:
    """Average of each sample's own phase share of its total — not a
    time-weighted average — so the one 58-minute sample doesn't drown out
    the other three."""
    shares = {"download": [], "split": [], "transcribe": []}
    for s in samples:
        total = s["total_seconds"]
        if total <= 0:
            continue
        shares["download"].append(s["download_seconds"] / total)
        shares["split"].append(s["split_seconds"] / total)
        shares["transcribe"].append(s["transcribe_seconds"] / total)
    return {phase: sum(values) / len(values) for phase, values in shares.items()}


def rate_limit_observations(samples: list[dict]) -> list[str]:
    observations = []
    for s in samples:
        errors = s.get("retryable_errors_encountered") or []
        count = errors.count("TranscriptionRateLimitError")
        if count:
            observations.append(
                f"{s.get('label') or s['video_url']}: rate limit hit ({count}x)"
            )
    return observations


def render_report(
    samples: list[dict],
    a: float,
    b: float,
    shares: dict[str, float],
    admission_limit_seconds: int,
) -> str:
    lines = [
        "# Execution Time measurement results",
        "",
        f"Sample count: {len(samples)} (recorded honestly — no percentiles are "
        "derived from this sample size; a line with a slope answers "
        '"how long for a video of this length" instead).',
        "",
        "## Samples",
        "",
        "| label | video_duration_s | download_s | split_s | transcribe_s | total_s | retryable errors |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for s in samples:
        errors = ", ".join(s.get("retryable_errors_encountered") or []) or "-"
        lines.append(
            f"| {s.get('label') or '-'} | {s['video_duration_seconds']} | "
            f"{s['download_seconds']} | {s['split_seconds']} | "
            f"{s['transcribe_seconds']} | {s['total_seconds']} | {errors} |"
        )
    lines += [
        "",
        "## Linear model",
        "",
        f"Execution Time ≈ {a:.3f} + {b:.6f} × video_duration_seconds",
        "",
        "## Phase share",
        "",
        "(average of each sample's own share of its total, not time-weighted)",
        "",
        f"- download: {shares['download']:.1%}",
        f"- split (re-encode): {shares['split']:.1%}",
        f"- transcribe: {shares['transcribe']:.1%}",
        "",
        "## Admission Limit projection",
        "",
    ]
    projected = a + b * admission_limit_seconds
    lines += [
        f"At the Admission Limit ({admission_limit_seconds}s = "
        f"{admission_limit_seconds / 3600:.2f}h, from "
        "REAL_TRANSCRIBE_MAX_DURATION_SECONDS's default), the model projects "
        f"Execution Time ≈ {projected:.1f}s ({projected / 60:.1f} min).",
        "",
        "## Downstream rate limiting",
        "",
    ]
    observations = rate_limit_observations(samples)
    if observations:
        lines.append(
            "Rate limiting was observed during this measurement run, at this "
            "usage pattern:"
        )
        lines.extend(f"- {o}" for o in observations)
    else:
        lines.append(
            "No TranscriptionRateLimitError was observed across the sampled "
            "runs at this usage pattern (sequential single requests, no "
            "concurrency)."
        )
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fit the Execution Time model from recorded samples."
    )
    parser.add_argument("--samples-file", type=Path, default=DEFAULT_SAMPLES_FILE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--admission-limit-seconds",
        type=int,
        default=DEFAULT_ADMISSION_LIMIT_SECONDS,
    )
    args = parser.parse_args(argv)

    samples = load_samples(args.samples_file)
    a, b = fit_linear_model(samples)
    shares = phase_shares(samples)
    report = render_report(samples, a, b, shares, args.admission_limit_seconds)

    args.output.write_text(report, encoding="utf-8")
    print(report)
    print(f"Written to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
