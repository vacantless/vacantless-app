# CODEX BUILD — Flag "couldn't-find-a-time" leads (S513b)

**Scope: S513b only** — make a renter who WANTED to book but couldn't distinguishable from a
generic website inquiry, so the operator can offer alternate times and the nurture drip stops
mis-nudging them to "come book" at the same thin calendar. Design: `claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md` §4.
(S513c reopen-notify is a separate follow-on and DEPENDS on this flag.)

App HEAD at spec time: `97362c6` + S513a/S514 in-flight. Latest migration: `0159`. **Use `0160`.**

**Live example this exists to fix (Basma Preston, 2026-07-18):** she hit `/r`, saw ~2 days of
times, none worked, clicked "Can't make these times? Send your details instead →" → a lead with
`source='website'`, byte-identical to a generic inquiry. Nobody could tell she wanted to book.

**Verified code refs (2026-07-18):**
- `app/r/[propertyId]/inquiry-form.tsx`: client state `skipTime` (set by the "send details
  instead" link) + prop `hasSlots` (line ~109) — NEITHER is submitted today.
- `app/r/[propertyId]/actions.ts` `submitLead` (~line 600–655): reads FormData → calls RPC
  `submit_public_lead`. The new-lead email is sent in the SAME file (~line 260,
  `eventKey:"leasing.new_lead"`, vars + `resolveLeadNotifyEmailsPreferMemberFallback`).
- RPC `submit_public_lead` latest def: `supabase/migrations/0147_submit_public_lead_dedup.sql`
  (params end at `p_custom_answers jsonb default '[]'`; stamps `source='website'`).
- `lib/nurture.ts` `STEP_COPY` (~117) + `app/api/cron/nurture/route.ts` (loads leads + org
  `nurture_enabled`). Nurture is time-based (+2/+5/+10d) and does NOT consider availability.
- `lib/lead-detail.ts` `resolveLeadSource` + `app/dashboard/leads/[id]/page.tsx` (lead detail;
  selects lead columns ~line 101).

---

## File 1 — `supabase/migrations/0160_lead_no_suitable_time.sql` (Codex writes; Cowork applies)

```sql
alter table public.leads
  add column if not exists no_suitable_time boolean not null default false;
```
Then **re-create `submit_public_lead`** (copy the WHOLE latest body from `0147` verbatim) with
ONE added trailing param and ONE added column in the leads INSERT:
- add param `p_no_suitable_time boolean default false` (trailing, defaulted → every existing
  caller/test keeps working).
- in the `insert into leads (...)`, set `no_suitable_time = coalesce(p_no_suitable_time, false)`.
- **Keep `source='website'` and everything else byte-identical** — the flag is orthogonal to
  source analytics. Preserve signature/return/security/search_path.

## File 2 — `app/r/[propertyId]/inquiry-form.tsx`

Submit a hidden field encoding the booking context at submit time:
- Emit `<input type="hidden" name="no_suitable_time" value="1">` when EITHER `skipTime` is true
  (renter was shown times and clicked "send details instead") OR `hasSlots` is false (page
  offered zero bookable times). Otherwise omit it (or value="").
- No-JS safety: when `hasSlots` is false the form already renders details-only, so emit the
  hidden `no_suitable_time=1` statically in that branch. The `skipTime` branch is JS-only
  (acceptable — a no-JS renter shown times who submits blank stays a plain inquiry, unchanged).

## File 3 — `app/r/[propertyId]/actions.ts`

- In `submitLead`: `const noSuitableTime = formData.get("no_suitable_time") === "1";` and pass
  `p_no_suitable_time: noSuitableTime` in the `submit_public_lead` RPC call.
- New-lead email (~line 260): add a template var `no_suitable_time_note` =
  `noSuitableTime ? "⚠ This renter couldn't find a workable viewing time — offer alternate times." : ""`
  into the `vars` passed to `sendOrgNotification`. (Additive; empty for normal inquiries.)

## File 4 — `lib/notifications.ts`

- Add `no_suitable_time_note` to the `leasing.new_lead` event's `tokens`.
- Inject `{{no_suitable_time_note}}` into that event's default body on its own line (renders the
  warning when set, collapses to nothing when empty). Do not disturb other events.

## File 5 — `lib/lead-detail.ts` + `app/dashboard/leads/[id]/page.tsx`

- Add `no_suitable_time` to the lead select in `page.tsx` (~line 101) and to the lead-detail
  type.
- Render a badge near the source label — **"Wanted to book — no suitable time"** — when
  `lead.no_suitable_time`. Put the pure logic in `lib/lead-detail.ts` (e.g. extend
  `resolveLeadSource` or a small helper) so it's testable; the page just renders it.

## File 6 — `lib/nurture.ts` + `app/api/cron/nurture/route.ts` (the mis-nudge fix)

**Chosen approach: distinct copy variant** (acknowledges the gap; does NOT depend on live
availability, so it's simple and composes with S513c). Noam may instead prefer "skip the step
while the calendar is thin" — if so, say and we'll swap; default to the variant below.
- Load `no_suitable_time` in the nurture route's leads select and thread it into the copy pick.
- In `STEP_COPY` selection, when `no_suitable_time` is true, use a distinct variant that does
  NOT say "come book now" but "we're lining up more viewing times and will let you know the
  moment they open" (mirror the existing tone/structure; keep the same step cadence). One small
  branch in the copy selector; leave normal-lead copy untouched.

## File 7 — `scripts/test-*.ts` (tsx)

- `no_suitable_time` round-trips: a submit with the hidden field → RPC param → column true; a
  normal submit → false. (If no DB harness, assert the RPC re-def contains the param + column
  set, and unit-test the action's FormData→param shaping.)
- The new-lead email `no_suitable_time_note` var renders when set, empty otherwise.
- The nurture copy selector returns the distinct variant for a flagged lead, normal copy
  otherwise.

## Guardrails / must-nots

- Keep `source='website'` unchanged — the flag is orthogonal; do not shift source analytics.
- The RPC param MUST be trailing + defaulted (backward compatible); re-create the RPC from the
  `0147` body verbatim except the one param + one column.
- Other orgs / normal inquiries MUST be unaffected: `no_suitable_time_note` empty, badge hidden,
  normal nurture copy unchanged.
- Do NOT build S513c (reopen-notify) here.
- Migration to prod via Supabase MCP; Codex writes the file only.

## Verify (Cowork, after Codex returns)

1. `device_bash git diff` in MAIN — only the files above; `git diff --check` clean; no migration
   applied by Codex.
2. Diff the re-created `submit_public_lead` against `0147` — confirm ONLY the new param + the
   `no_suitable_time` column changed (nothing else in that large body drifted).
3. Stage + run the tests in the cloud.
4. Apply `0160`; rolled-back functest: a lead insert with `p_no_suitable_time=>true` stamps the
   column; `false`/omitted → false; `source` still `website`.
5. Noam pushes; Vercel READY. Browser-check: submit via the `/r` "send details instead" path →
   lead shows the badge + the new-lead email carries the warning line.
