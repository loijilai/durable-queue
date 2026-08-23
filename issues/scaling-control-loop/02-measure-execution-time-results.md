# Execution Time measurement results

Sample count: 4 (recorded honestly — no percentiles are derived from this sample size; a line with a slope answers "how long for a video of this length" instead).

## Samples

| label | video_duration_s | download_s | split_s | transcribe_s | total_s | retryable errors |
| --- | --- | --- | --- | --- | --- | --- |
| 8m34s | 515 | 1.825 | 0.937 | 20.985 | 23.747 | - |
| 20m43s | 1243 | 4.657 | 2.077 | 30.246 | 36.979 | - |
| 58m45s | 3525 | 31.956 | 5.597 | 81.248 | 118.801 | - |
| 2h08m | 7693 | 24.97 | 11.371 | 151.616 | 187.957 | - |

## Linear model

Execution Time ≈ 16.187 + 0.023330 × video_duration_seconds

## Phase share

(average of each sample's own share of its total, not time-weighted)

- download: 15.1%
- split (re-encode): 5.1%
- transcribe: 79.8%

## Admission Limit projection

At the Admission Limit (14400s = 4.00h, from REAL_TRANSCRIBE_MAX_DURATION_SECONDS's default), the model projects Execution Time ≈ 352.1s (5.9 min).

## Downstream rate limiting

No TranscriptionRateLimitError was observed across the sampled runs at this usage pattern (sequential single requests, no concurrency).
