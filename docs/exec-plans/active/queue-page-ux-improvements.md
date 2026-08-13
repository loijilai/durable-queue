# Queue page UX improvements

- Status: awaiting-final-review
- Started: 2026-08-13
- Updated: 2026-08-13

## Context

`frontend/src/pages/QueuePage.tsx` renders the job board used to demo the
durable queue. The product owner flagged four demo-blocking UX issues after
using the page:

1. Newly submitted jobs visually move to the bottom of the list, forcing a
   scroll during demos.
2. No video thumbnail is shown per job.
3. There is no way to copy a job's transcript.
4. Long transcripts make `.job-card` grow unbounded, hurting readability.

Investigation findings (see `QueuePage.tsx` and `frontend/src/lib/api.ts`):

- `handleSubmit` already prepends the new job
  (`setJobs((prev) => [created, ...prev])`, `QueuePage.tsx:139`), but the
  initial `listJobs` fetch (`QueuePage.tsx:103-110`) and the 2s poll
  (`QueuePage.tsx:115-130`) both do a full `setJobs(updated)` replace using
  whatever order `GET /api/jobs/` returns, which is not guaranteed to be
  newest-first. That reorder is what the product owner is observing.
- `TranscriptionJob` (`frontend/src/lib/api.ts:49-59`) has no thumbnail
  field, and the backend model/serializer store only `video_url`. The
  serializer already rejects non-YouTube URLs at job-creation time
  (`durable_queue/jobs/serializers.py`, confirmed by
  `durable_queue/jobs/tests/test_serializer.py`), so every job that exists in
  the list is guaranteed to have a parseable YouTube URL. Per product owner
  decision, thumbnails are derived client-side from `video_url` using
  YouTube's public thumbnail endpoint
  (`https://img.youtube.com/vi/<id>/mqdefault.jpg`) — no backend change.
- There is no clipboard utility anywhere in `frontend/src/`.
- `.job-transcript` (`frontend/src/index.css:1258-1266`) has no height cap.
  The existing `expandedIds` `Set<number>` toggle pattern
  (`QueuePage.tsx:89-98`, used for the audit-trail inspector at
  `QueuePage.tsx:250-266`) is the established precedent for expand/collapse
  UI on this page and will be reused for transcript truncation.

## Goal

Make the queue page usable for live demos: new jobs stay pinned to the top,
each job card shows a YouTube thumbnail, transcripts can be copied in one
click, and long transcripts no longer blow up card height.

## Acceptance criteria

- [x] After submitting a job, and after every subsequent poll tick, jobs stay
      sorted newest-first (by `created_at`) — submitting a new job never
      requires scrolling to see it.
- [x] Each job card shows a YouTube thumbnail derived from `video_url`
      (`https://img.youtube.com/vi/<id>/mqdefault.jpg`).
- [x] Each succeeded job with a transcript has a "Copy" control that copies
      the full transcript text to the clipboard, with visible success
      feedback (e.g. label changes to "Copied").
- [x] Transcripts longer than a fixed height are visually truncated with a
      "Show more" / "Show less" control; short transcripts render unchanged.
- [x] `npm run lint` and `npm run build` pass in `frontend/`.

## Out of scope

- Backend changes (no new fields, no new endpoints).
- Non-YouTube video sources.
- Broader visual redesign beyond these four fixes.

## Implementation plan

- [x] Add a `sortByCreatedAtDesc` helper in `QueuePage.tsx` and apply it to
      the two API-driven `setJobs` call sites (initial `listJobs` fetch,
      poll interval) so list order is always newest-first regardless of
      backend ordering.
- [x] Add a `getYouTubeThumbnailUrl(videoUrl)` helper that extracts the video
      ID from standard YouTube URL forms (`watch?v=`, `youtu.be/`,
      `/embed/`) and returns the `img.youtube.com` thumbnail URL; render an
      `<img>` in `.job-card` using it, with an `onError` fallback that hides
      the broken image instead of showing a broken-image icon.
- [x] Add a copy-to-clipboard button next to `.job-transcript`
      (`QueuePage.tsx:232-234`) using `navigator.clipboard.writeText`, with
      local per-job "Copied" state that reverts after ~1.5s.
- [x] Add transcript truncation: reuse the `expandedIds`-style toggle pattern
      (new `expandedTranscriptIds` set) with CSS `max-height` + `overflow:
      hidden` on `.job-transcript` when collapsed, and a "Show more/less"
      button that only renders when the transcript actually overflows
      (heuristic: transcript length > 220 chars).
- [x] Add/update CSS in `frontend/src/index.css` for the thumbnail, copy
      button, and truncated transcript states, consistent with existing
      `.btn-secondary`/`.btn-inspect` styling.
- [x] Manually verify in the browser: submit a job, confirm it appears on
      top and stays on top through polling; confirm thumbnail renders;
      confirm copy button copies transcript; confirm a long transcript
      truncates and expands/collapses correctly.
- [x] Run `npm run lint` and `npm run build` in `frontend/`.

## Progress

- 2026-08-13: Plan drafted from user-approved discussion (ordering fix,
  YouTube-only thumbnails, copy button, transcript truncation).
- 2026-08-13: Implementation approved by the product owner (approach agreed
  in prior discussion, explicit "write plan then execute" instruction);
  status changed to `active`.
- 2026-08-13: Implemented all four fixes in `QueuePage.tsx`/`index.css` and
  verified end-to-end in a real browser (Playwright) against a local
  `docker compose` backend (`TRANSCRIBER=fake`): registered a user,
  submitted three jobs, confirmed the top card stays pinned across poll
  ticks, confirmed thumbnails render from `video_url`, and confirmed
  copy-to-clipboard and show-more/less truncation both work against a
  seeded long transcript. Verification containers/dev server were torn
  down afterward.

## Checkpoint commits

- `0bf625d` — all four fixes implemented, lint/build/manual browser
  verification passed.

## Decision log

- Thumbnails are derived client-side from `video_url` via YouTube's public
  thumbnail endpoint rather than adding a backend field, since all jobs are
  confirmed YouTube-only (product owner decision) and the backend already
  rejects non-YouTube URLs at creation time.

## Discoveries and risks

- Backend list ordering for `GET /api/jobs/` was not confirmed to be
  deterministic; fixing sort order client-side avoids depending on it.
- The fake transcriber (`durable_queue/jobs/transcribers.py:48-50`, used
  when `TRANSCRIBER=fake`) always returns a fixed 22-character string, too
  short to exercise the truncation UI. Truncation was verified by seeding a
  long transcript directly into a job row via `manage.py shell` after the
  job succeeded, then reloading the page — this only affected the
  verification method, not the shipped code path.
- Truncation uses a character-length heuristic (220 chars) rather than
  measuring actual DOM overflow (`scrollHeight`), since the card width and
  font are fixed for this page; acceptable for this UI but would need
  revisiting if `.job-transcript` width/font ever becomes dynamic.

## Verification results

- `npm run lint` (oxlint --deny-warnings): passed, no warnings.
- `npm run build` (tsc -b && vite build): passed; only the pre-existing
  large-chunk warning (unrelated to this change, already noted in
  `docs/architecture.md`).
- Manual browser verification (Playwright against `docker compose` backend
  with `TRANSCRIBER=fake`): registered a user, submitted 3 jobs — newest
  job stayed the top card through 6s of polling; both jobs rendered a
  `https://img.youtube.com/vi/<id>/mqdefault.jpg` thumbnail; seeded a
  1139-char transcript on the top job, confirmed "Show more"/"Show less"
  toggle expand/collapse and "Copy" writes the full transcript to the
  clipboard with "Copied ✓" feedback. Screenshots captured during the run
  confirm all four behaviors visually.

## Handoff

All four acceptance criteria are implemented and verified. Status set to
`awaiting-final-review` — awaiting explicit human approval to move this
plan to `completed/`.
