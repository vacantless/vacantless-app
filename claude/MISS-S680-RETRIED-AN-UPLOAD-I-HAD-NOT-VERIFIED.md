# MISS S680 - I retried a photo upload I had not verified, and duplicated 7 rows

2026-09-04, Unit 36 (`15a8a7de`). My error, recorded so it does not repeat.

## What happened

1. Uploaded batch 1 (7 photos). Confirmed in Supabase: 7 rows. Correct.
2. Loaded batch 2 into the file input and clicked Upload.
3. Queried Supabase **immediately**: still 7. Screenshotted: the panel had **collapsed and
   re-rendered** into the summary card reading "7/24 photos".
4. **I inferred the upload had landed on a detached input and re-ran it.** Wrong. It had landed;
   it was simply still in flight when I looked, and the re-render was the panel's normal
   post-upload behaviour, not evidence of failure.
5. Result: **21 rows instead of 14** - batch 2 written twice.

## The two mistakes

- **I read "count has not increased yet" as "the write failed."** An async upload that has not
  finished and an upload that never started are indistinguishable from a single instantaneous
  count. The distinguishing move is to WAIT and re-poll, which I did on the very next step and
  which showed 9 then 21.
- **I treated a UI re-render as a failure signal.** The panel collapsing to a summary card was
  the app confirming success, and I read it as the input being lost.

## The rule

**Before retrying any write, re-poll the source of truth at least once after a deliberate wait.
A count that has not moved yet is not a failed write.** This is the write-side twin of the
existing "verify by reading back" rule, and of "a blocked PATH is not an absent ASSET" - absence
of an observation is not evidence of absence of the thing.

Corollary for this app specifically: **the photo panel re-renders into a summary card after a
successful upload.** That is success, not a lost input. Do not re-run on the strength of it.

## Cleanup DONE 2026-09-04 (Noam gave an explicit go; Cowork drove it)

7 duplicate rows, identified deterministically by joining `property_photos` to `storage.objects`
and pairing on `metadata->>'size'` (each of the 7 batch-2 byte sizes appears exactly twice; the
sizes match the source files on disk byte for byte). **Keep `sort_order` 7-13, remove 14-20:**

| sort | id | bytes | duplicate of |
|---|---|---|---|
| 14 | `0e3f8a79-ae70-4ed1-a90f-a6ec9261413b` | 342227 | 07-bathroom |
| 15 | `560bd75c-1af3-4101-ae3e-1be8525dcb00` | 363305 | 08-kitchen-alt |
| 16 | `9bacb6b7-0355-42ab-bbe4-8d106175ac19` | 259917 | 09-hallway |
| 17 | `2880ded8-067b-48ee-991b-c68ef1bef3b4` | 316892 | 10-hallway-closet |
| 18 | `e92ddbd2-34f2-493a-8d7a-8df8f3e83846` | 337573 | 11-entry-interior |
| 19 | `babc605a-fa6c-470b-a007-f8f87b3575f7` | 235575 | 12-front-door |
| 20 | `48b2571b-0c54-47d5-a573-09f487cbbb58` | 494748 | 12-exterior-facade |

**Removed via the app's own photo-grid Delete control, deleting from the LAST tile backwards** so
re-indexing could not shift the targets, with the row count re-polled between passes. Chosen over
SQL because the UI delete removes the storage object as well as the row; a SQL delete would have
orphaned 7 objects.

**Verified after** [2026-09-04 via Supabase, joining `storage.objects` on size]:
`photos = 14`, `distinct_sizes = 14`, `duplicate_sizes = 0`, `covers = 1`, and the sort order is
exactly the intended one, cover first:

`01-kitchen-hero` (cover), `02-exterior`, `02-living-to-kitchen`, `03-room-window`,
`04-bedroom-window`, `05-bedroom-two`, `06-room-closet`, `07-bathroom`, `08-kitchen-alt`,
`09-hallway`, `10-hallway-closet`, `11-entry-interior`, `12-front-door`, `12-exterior-facade`.

The deletes needed **no confirmation step** - a single click on a tile's Delete removes it
immediately. Worth knowing before clicking one by accident.

**Risk was bounded throughout:** the listing was a Draft (no renter had seen it) and all 14
sources were still staged, so a wrong deletion was a one-minute re-upload, not a loss.

This is the same duplicate-accumulation shape as 50 Glenrose Unit 5 (~16 duplicates from a retry
loop). Second occurrence. The app has no upload idempotency: filenames are re-keyed to UUIDs on
write, so re-uploading the same file always creates a new row rather than colliding.

[[project_agile_leasing_engine]]
