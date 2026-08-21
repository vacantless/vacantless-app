# CODEX PROMPT — Smart-lock battery reminder (S610)

**Base = main (prod HEAD 046b251). Ships DARK behind a `has_smart_lock` unit feature (default false) — no org gets a reminder until a unit is flagged. Additive migration only. Do not `git push` — Noam reviews and pushes.**

Wave 1 / Lane 2 of the S610 backlog build. File-disjoint from the entitlements, receipt-vault, and spend-analysis lanes.

## WARM-VERIFY FIRST — grep, and STOP if already built
Confirm none of this exists yet (as of prod it does not):
- `rg -i "smart.?lock|has_smart_lock|lock.?battery"` across `app lib components supabase/migrations messages` → expect nothing.
- `lib/property-features.ts` — the unit feature booleans (air_conditioning, balcony, furnished, pets, heat/hydro/water_included, on_site_management). There is NO lock feature. Add one.
If a smart-lock feature or reminder already exists, STOP and report.

## WHAT THIS IS
A recurring "replace the smart-lock batteries" reminder for units flagged with a smart lock — the exact same shape as the existing detector / equipment end-of-life sweeps, on a fixed cadence (default every 6 months; make the interval a constant).

## REUSE (import; do NOT modify the source modules)
This is a near-copy of an existing pattern — mirror it, don't invent:
- `lib/detector-eol-sweep.ts` and `lib/equipment-eol-sweep.ts` — the sweep template (find due items → enqueue a reminder → stamp last-sent, idempotent).
- `lib/detector-eol.ts` / `lib/equipment-eol.ts` — the pure due-date logic to mirror.
- `lib/compliance-calendar.ts` + `compliance_reminder_log` (migration `0079`) — the reminder scheduling + de-dupe log; reuse the log table (add a `reminder_kind` value like `smart_lock_battery` if the schema keys on kind) rather than a new log.
- `lib/property-features.ts` — add `has_smart_lock` to the unit feature set (parse/serialize + label).
- The existing cron pattern under `app/api/cron/*` (e.g. the detector/equipment EOL cron) for the daily/periodic drain.

## FILES — exact scope
- NEW migration `supabase/migrations/0201_unit_smart_lock.sql` — additive `has_smart_lock boolean not null default false` on the units/property-features table (match where the sibling feature booleans live), plus a `last_smart_lock_battery_reminder_at timestamptz` (or reuse `compliance_reminder_log` keyed by kind — pick whichever matches the detector/equipment precedent). RLS org-scoped; `service_role` SELECT (cron reads it).
- EDIT `lib/property-features.ts` — include `has_smart_lock` in the feature parse/serialize + a human label.
- NEW `lib/smart-lock-battery.ts` — pure due logic (interval constant, `isDue(lastSentAt, now)`), no I/O.
- NEW `lib/smart-lock-battery-sweep.ts` — the sweep (find flagged units due → send via the same reminder path detector/equipment use → stamp last-sent). Idempotent; a same-day re-run is a no-op.
- Wire into the existing EOL cron route (edit it) or add a thin `app/api/cron/smart-lock-battery/route.ts` mirroring the detector cron; guard with the same secret check.
- NEW `scripts/test-smart-lock-battery.ts` — due-logic + idempotency, `npx tsx`.

## CONSTRAINTS / INVARIANTS
- **Dark by data:** default `has_smart_lock=false` → the sweep finds nothing → zero behavior change until a unit is flagged. Prove it.
- Idempotent: reminder de-dupes via last-sent / `compliance_reminder_log`; re-running the cron the same day sends nothing new.
- Pure due logic in `lib/smart-lock-battery.ts`, unit-tested; no DB/network in the pure module.
- Additive migration only; RLS org-scoped; `service_role` SELECT for the cron path.
- esbuild-check any edited `.tsx`. Do NOT git push.

## VERIFICATION (Cowork re-runs)
- `scripts/test-smart-lock-battery.ts` passes: due at/after interval, not-due before, idempotent stamp.
- With no unit flagged, the sweep returns 0 sends (dark).
- Migration applied to prod via Supabase MCP only on Noam's explicit go, after a rolled-back functest.

## OUT OF SCOPE
Any smart-lock hardware/API integration (this is a calendar reminder only). Battery-level telemetry. Door-code management.
