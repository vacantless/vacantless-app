# FINDINGS S681 - the escalation event existed all along. Nothing swept the backlog.

Session 681, 2026-09-06. Prompted by Noam asking what a new signup would experience.

## The correction I had to make first

I claimed earlier this session that **no notification event existed** for
`needs_operator` / `needs_payment` / `needs_login`. **That was wrong.** I had grepped
`lib/notifications.ts` for the STATUS STRINGS; the event is keyed on gate labels, so the
grep missed it.

**`leasing.distribution_job_needs_action` exists, is `active: true`, has correct operator
copy, and is wired to `/api/cron/distribution-worker`**, which the GitHub Action really
does trigger. It is also **enabled by default**: `isEventEnabled(null)` returns `true`, so
an absent `notification_settings` row means ON. No org has a row for it.

The event's own `description` says *"Off until you turn it on."* **That sentence is false**
and should be corrected; it describes opt-in behaviour the code does not implement.

## So why did nine items sit for up to 54 days

**Two causes, and the second is the new-signup answer.**

**1. The notification only ever fired at the INSTANT the cron moved an item to its gate.**
There was no backlog pass. Anything that reached a gate by another path, or before that
code shipped, was never mentioned again.

**2. Abbas Husain's org has NO `distribution_channel_accounts` row at all.** Only Agile and
Growth Test have any. His concierge Kijiji item had been `queued` **48 days**. The cron's
eligibility check requires `automation_authorized === true`; with no row that is false, so
every run returned `no_authorized_job` and wrote nothing. Silently, forever.

**That is the new-user experience, measured rather than imagined:** sign up, request
done-for-you posting, and the system says nothing to anyone for seven weeks.

## What shipped

**No new event.** The sweep reuses the existing one, its recipients, and its templates.

- **Migration `0224`** adds `distribution_run_items.last_stuck_alerted_at` plus a partial
  index on the four swept statuses. **Applied to production 2026-09-06 and verified by the
  OBJECTS** (column + `distribution_run_items_stuck_sweep_idx`), not the ledger.
- **`lib/distribution-stuck-sweep.ts`**, pure and unit-tested. Thresholds: parked over
  **24h**, re-nag at most every **7 days**, at most **5 alerts per sweep**.
- **`runStuckSweep` in the cron route**, running **BEFORE the env dark gate on purpose**.
  That gate guards POSTING. Telling an operator an item has been parked for weeks is a read
  and an email, and withholding it while the worker is dark is exactly how this happened.
  Wrapped so a missing column can never break the posting worker.

## The audit caught a real bug BEFORE it shipped

Predicting the first sweep against live data showed **the nine oldest due items all belong
to one QA org**. Oldest-first with a cap of five would have burned three daily runs on that
org before naming the first real customer (Abbas, position 10) and four before Agile
(position 16).

**Fix: one alert per organization per sweep, each org's oldest item.** Every affected org is
surfaced on the first run. It needs no notion of which orgs are "real", which is not
knowable in that code. Locked down by tests shaped like the live backlog.

## A SECOND audit, after deploy, caught a worse one

**The GitHub Action runs every 15 minutes, not daily.** I had reasoned about the
5-per-sweep cap as if the cadence were daily. It is not, and a per-invocation cap is not a
rate limit: run one stamps one item per org, run two picks each org's NEXT item, and the
whole backlog goes out. Measured: **33 due items, so roughly 33 emails in about two
hours.**

**Emergency brake applied first, at 2026-09-06, before the next tick:** stamped
`last_stuck_alerted_at = now()` on all due items EXCEPT each org's oldest, leaving exactly
four to fire (one per org, the intended behaviour) and suppressing the rest for the 7-day
re-nag window. Non-destructive, and it bought the time to fix the code properly.

**Then the real fix:** the per-org limit now holds ACROSS sweeps, not just within one. A new
`orgLastAlertedMs` derives each org's most recent stamp from the same rows the sweep already
reads, and an org is skipped entirely while it is inside the re-nag window. "This org has
stuck work" is an org-level fact, so a stamp on one item correctly silences its siblings.

**The lesson worth keeping: a per-invocation cap says nothing about volume until you know
the invocation rate.** I checked the schedule only after shipping. Read the cron cadence
BEFORE reasoning about any per-run limit.

## What this does NOT do

**It does not post anything.** It converts silent failure into visible failure. That is the
precondition for delegating syndication, not syndication.

## Verified
- `npx tsc --noEmit`: exit 0
- `scripts/test-distribution-stuck-sweep.ts`: **33 passed, 0 failed**
- Two of those tests failed first against the one-per-org change and were corrected as
  TESTS (they had shared an org id while testing ordering). The failure was the suite
  working.

## Still open
- The `active: true` event description's "Off until you turn it on" line is wrong copy.
- `distribution_channel_accounts.requires_payment` is written from the static catalog on
  every Settings save (`settings/actions.ts`, `distribution-actions.ts`), so a per-account
  truth such as "this Kijiji account is personal and has a free slot" **has nowhere to
  live**. There is no `account_type` or free-slot column anywhere. Same failure class as
  the S681 delete bug: two sources of truth, the writer wins silently.

[[project_agile_leasing_engine]]
