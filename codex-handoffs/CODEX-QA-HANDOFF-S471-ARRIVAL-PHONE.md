# Codex QA handoff — S471 + S471b: operator-editable showing ARRIVAL PHONE

Consolidated review for the whole arrival-phone batch. Please review as one unit.

## What shipped + why
The booking-confirmation "text/call on arrival" number used `organizations.public_contact_phone`,
which is OVERLOADED (also feeds the syndication `<phone>` and the N1/rent-receipt landlordPhone).
Blanking it for a feed reason (Agile, S449) silently dropped the renter's arrival contact. This
batch adds a DEDICATED, operator-editable arrival phone: org-level DEFAULT + optional per-property
OVERRIDE, resolved `property -> org default -> public_contact_phone`, surfaced in the booking
confirmation AND the 24h/2h reminder.

## Commits / artifacts
- **S471** `d5c783a` — LIVE + Vercel READY (verified live: /n1 official PDF + this feature's data path).
- **S471b** — the commit produced by `DEPLOY-S471b-ARRIVAL-PHONE-UX.sh` (UX pass; may not be pushed yet).
- **Migration 0136** `supabase/migrations/0136_showing_arrival_phone.sql` — APPLIED to prod via MCP
  and SQL-verified (org default, property override, and blank->public fallback all confirmed).

## Files
- `supabase/migrations/0136_showing_arrival_phone.sql` — 2 columns + repointed `get_booking_confirmation_extras`.
- `lib/showing-contact.ts` — `resolveArrivalPhone` (server-path precedence, mirrors the RPC) + `telDialString` (extension pause-dial).
- `lib/email.ts` — reminder now carries access notes + arrival phone (`viewingLogisticsHtml`); tel: href uses `telDialString`.
- `app/api/cron/reminders/route.ts` — select + resolve + pass to `sendShowingReminder`.
- `app/dashboard/settings/actions.ts` — S471 added `updateShowingArrivalPhone`; S471b REMOVED it and folded the field into `updateRenterMessages`.
- `app/dashboard/settings/page.tsx` — S471b: field moved from the (collapsed) feed panel to Communications -> Renter Messages.
- `app/dashboard/properties/[id]/page.tsx` — per-property override field + copy.
- `scripts/test-showing-contact.ts` — 12/0 (resolveArrivalPhone + telDialString).

## Review focus (priority order)
1. **[HIGHEST] Access-note exposure.** S471 threads `properties.showing_instructions` into the RENTER
   reminder; the booking confirmation has rendered it to renters since S448. But the property-page
   copy calls that field agent-private ("Not shown to renters", placeholder = a LOCKBOX CODE). Is
   showing_instructions intended to be renter-facing? If not, this leaks access codes to every renter
   who books. Flag the correct posture (fix the copy, or gate the field out of renter emails).
2. **RPC** `get_booking_confirmation_extras` — SECURITY DEFINER + `search_path=public`, the
   `coalesce(nullif(btrim(...),''), ...)` precedence, additive/backward-compat (both columns default
   NULL -> unchanged behaviour). Confirm no RLS/privilege regression (anon calls it).
3. **Precedence parity** — does `resolveArrivalPhone` (TS, used by the reminder cron) resolve
   IDENTICALLY to the SQL RPC (property override -> org default -> public_contact_phone), including
   whitespace-only handling?
4. **`telDialString`** — regex `(?:ext\.?|x|#)\s*(\d{1,6})\s*$`, extension edge cases, and injection
   safety of the resulting `tel:` href (output is digits/`+`/`,` only, wrapped in escapeHtml).
5. **Lenient validation** — both arrival fields store trimmed free text (no format reject) so a save
   is never blocked; the tel: link sanitizes. Acceptable, or do we want a soft format hint?
6. **Reminder cron** — the added columns in the select; `org`/`property` are `any` (Array.isArray
   ternary) so column reads compile; confirm no null-deref.
7. **S471b UX** — arrival phone folded into `updateRenterMessages` (one save with the feedback/nurture
   toggles); confirm the combined save + the removal of `updateShowingArrivalPhone` are clean.

## Out of scope / not this batch
- The N-form library (`N-FORM-LIBRARY-DESIGN-2026-07-12.md`) is DESIGN ONLY — no code.
- N1 official PDF (S469/S470) is closed; only re-touch if (1) surfaces a shared-formatter issue.

---
## Batch update (S471c + S473) — read before reviewing
- **S471c (70252c2)** = build fix only: the S471b commit (4acf0cc) accidentally captured your
  in-flight distribution-publish page.tsx integration without lib/distribution-publish.ts, so
  Vercel failed module_not_found; S471c reverted page.tsx to arrival-phone-only. 4acf0cc never
  deployed. Nothing to review in S471c beyond "page.tsx = arrival-phone only".
- **S473 (53b4976) ALREADY FIXES priority finding #1** (showing_instructions leaking to renters):
  lib/email.ts viewingLogisticsHtml no longer renders the "Getting in:" row and the 3 renter
  emails no longer pass showing_instructions. It is now AGENT-ONLY (still shown on /agent/[token]).
  Please VERIFY that fix is complete (no other renter surface renders showing_instructions) rather
  than re-flag it. The RPC + reminder cron still SELECT showing_instructions but it is now dead/unused
  (harmless) — call out if you want it removed for tidiness.
- **Full review range: d5c783a (S471) .. 53b4976 (S473)** on main. Migration 0136 applied to prod.
  Focus items #2-#7 above still stand.
