#!/usr/bin/env python3
"""Batch Submitter for issues/scaling-control-loop/10-burst-submitter.md.

Plays the Batch Submitter role from issues/scaling-control-loop/spec.md: a
scheduled service that submits several hundred Jobs in a short window and
cares about throughput, not any single Job's latency (see CONTEXT.md).

Deliberately a minimal script, not a load-testing framework: what's under
test is the queue's absorption capacity and the scaling policy it drives,
not requests-per-second the API can serve. It submits `--count` Jobs at a
fixed concurrency (a thread pool of `--concurrency` workers, no ramp-up, no
pacing) and records the timestamp of each submission attempt — not
Acceptance, which the server already timestamps as the Job's created_at —
for later comparison against the capacity dashboard.

Usage (against a local stack, e.g. `docker compose up`):

    python3 scripts/batch_submitter.py \\
        --username batch-submitter --password changeme \\
        --count 300 --concurrency 20 --output /tmp/burst-results.json

The account must already exist (see /api/auth/register/); this script only
obtains a JWT and submits Jobs with it.
"""

from __future__ import annotations

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import requests

DEFAULT_API_URL = "http://localhost:8000"
DEFAULT_COUNT = 300
DEFAULT_CONCURRENCY = 20
DEFAULT_VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def get_access_token(api_url: str, username: str, password: str) -> str:
    """Exchanges credentials for a JWT access token via /api/auth/token/."""
    response = requests.post(
        f"{api_url}/api/auth/token/",
        json={"username": username, "password": password},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["access"]


def _result(index: int, submitted_at: str, status_code, job_id, error: str | None) -> dict:
    return {
        "index": index,
        "submitted_at": submitted_at,
        "status_code": status_code,
        "job_id": job_id,
        "error": error,
    }


def submit_job(api_url: str, token: str, video_url: str, index: int) -> dict:
    """Submits one Job and records the timestamp of the submission attempt
    (just before the request goes out) — not Acceptance, which the server
    already timestamps as the Job's created_at (see spec.md's testing
    decisions). This script's timestamp exists to place each submission on
    the same time axis as the capacity dashboard, independent of how long
    the API itself took to respond."""
    submitted_at = datetime.now(timezone.utc).isoformat()
    try:
        response = requests.post(
            f"{api_url}/api/jobs/",
            json={"video_url": video_url},
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        if response.status_code == 201:
            return _result(
                index, submitted_at, response.status_code, response.json()["id"], None
            )
        return _result(
            index, submitted_at, response.status_code, None, response.text
        )
    except requests.RequestException as exc:
        return _result(index, submitted_at, None, None, str(exc))


def run_burst(
    api_url: str,
    token: str,
    *,
    count: int,
    concurrency: int,
    video_url: str,
) -> list[dict]:
    """Submits `count` Jobs at a fixed concurrency of `concurrency` workers.
    Returns one result record per Job, in completion order."""
    results = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [
            pool.submit(submit_job, api_url, token, video_url, index)
            for index in range(count)
        ]
        for future in as_completed(futures):
            results.append(future.result())
    return results


def write_results(path: Path, results: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Batch Submitter: submit a burst of Jobs at a fixed concurrency "
            "and record each one's Acceptance timestamp."
        )
    )
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--count", type=int, default=DEFAULT_COUNT)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--video-url", default=DEFAULT_VIDEO_URL)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args(argv)

    token = get_access_token(args.api_url, args.username, args.password)

    results = run_burst(
        args.api_url,
        token,
        count=args.count,
        concurrency=args.concurrency,
        video_url=args.video_url,
    )

    accepted = sum(1 for result in results if result["status_code"] == 201)
    rejected = len(results) - accepted
    print(f"Submitted {len(results)} Jobs: {accepted} accepted, {rejected} rejected.")

    if args.output is not None:
        write_results(args.output, results)
        print(f"Written to {args.output}")
    else:
        print(json.dumps(results, indent=2, ensure_ascii=False))

    return 0 if rejected == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
