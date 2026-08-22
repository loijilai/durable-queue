#!/usr/bin/env python3
"""Timing harness for issues/scaling-control-loop/02-measure-execution-time.md.

A one-shot tool, deliberately outside the jobs/ production-code boundary
(scripts/check_architecture.py only walks durable_queue/jobs) and outside the
Celery task path: it calls jobs/transcribers.py's download/split/transcribe
functions directly and puts a timer around each phase, since real_transcribe()
itself does not expose phase-level timings.

Usage (one real video per invocation — this hits network, ffmpeg, and the
OpenAI API, and costs money/time):

    python3 scripts/measure_execution_time.py <video_url> --label 2m08s

Each run appends one JSON record to
issues/scaling-control-loop/execution-time-samples.json. Run
scripts/analyze_execution_time.py once samples are collected to fit the
model.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "durable_queue"
sys.path.insert(0, str(APP))

from jobs import transcribers  # noqa: E402

DEFAULT_SAMPLES_FILE = (
    ROOT / "issues" / "scaling-control-loop" / "execution-time-samples.json"
)


def _transcribe_chunks_with_retry(chunk_paths, timeout_seconds):
    """Mirrors jobs.transcribers._transcribe_chunk_with_retry's retry/backoff
    behavior (so the timed transcribe phase reflects real production retry
    cost), but also records which retryable error types were observed, so a
    rate-limit signal survives even when the retry ultimately succeeds."""
    transcripts = []
    errors_seen = []
    for chunk_path in chunk_paths:
        for attempt in range(1, transcribers.CHUNK_MAX_ATTEMPTS + 1):
            try:
                transcripts.append(
                    transcribers._call_openai(chunk_path, timeout_seconds)
                )
                break
            except transcribers.TranscriptionRetryableError as exc:
                errors_seen.append(type(exc).__name__)
                if attempt == transcribers.CHUNK_MAX_ATTEMPTS:
                    raise
                time.sleep(min(2 ** (attempt - 1), 10))
    return transcripts, errors_seen


def measure(
    video_url: str,
    *,
    timeout_seconds: int | None = None,
    chunk_seconds: int | None = None,
    max_duration_seconds: int | None = None,
) -> dict:
    """Run the real download -> split -> transcribe pipeline for one video
    and return per-phase timings. Raises whatever jobs.transcribers raises
    on failure (unclassified as a sample; the caller decides what to do)."""
    timeout_seconds = timeout_seconds or int(
        os.environ.get("REAL_TRANSCRIBE_TIMEOUT_SECONDS", "120")
    )
    chunk_seconds = chunk_seconds or int(
        os.environ.get(
            "REAL_TRANSCRIBE_CHUNK_SECONDS", str(transcribers.DEFAULT_CHUNK_SECONDS)
        )
    )
    max_duration_seconds = max_duration_seconds or int(
        os.environ.get("REAL_TRANSCRIBE_MAX_DURATION_SECONDS", "14400")
    )

    tmp_dir = tempfile.mkdtemp(prefix="durable-queue-measure-")
    try:
        download_start = time.monotonic()
        audio_path, video_duration = transcribers._download_audio(
            video_url, tmp_dir, timeout_seconds
        )
        download_seconds = time.monotonic() - download_start

        if video_duration is not None and video_duration > max_duration_seconds:
            raise transcribers.PermanentInputError(
                f"Video duration {video_duration}s exceeds the configured "
                f"limit of {max_duration_seconds}s."
            )

        split_start = time.monotonic()
        chunk_paths = transcribers._split_into_chunks(
            audio_path, tmp_dir, chunk_seconds
        )
        split_seconds = time.monotonic() - split_start

        transcribe_start = time.monotonic()
        _, errors_seen = _transcribe_chunks_with_retry(chunk_paths, timeout_seconds)
        transcribe_seconds = time.monotonic() - transcribe_start

        return {
            "video_url": video_url,
            "video_duration_seconds": video_duration,
            "chunk_count": len(chunk_paths),
            "download_seconds": round(download_seconds, 3),
            "split_seconds": round(split_seconds, 3),
            "transcribe_seconds": round(transcribe_seconds, 3),
            "total_seconds": round(
                download_seconds + split_seconds + transcribe_seconds, 3
            ),
            "retryable_errors_encountered": errors_seen,
        }
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _load_samples(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _append_sample(path: Path, sample: dict, label: str | None) -> None:
    samples = _load_samples(path)
    samples.append({"label": label, **sample})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(samples, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Measure real transcription execution time for one video, "
            "phase by phase, and append the sample to a JSON file."
        )
    )
    parser.add_argument("video_url")
    parser.add_argument(
        "--label",
        default=None,
        help="Human-readable label for this sample (e.g. a video length).",
    )
    parser.add_argument(
        "--samples-file", type=Path, default=DEFAULT_SAMPLES_FILE
    )
    args = parser.parse_args(argv)

    print(f"Measuring {args.video_url} ...")
    sample = measure(args.video_url)
    print(json.dumps(sample, indent=2, ensure_ascii=False))

    _append_sample(args.samples_file, sample, args.label)
    print(f"Appended to {args.samples_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
