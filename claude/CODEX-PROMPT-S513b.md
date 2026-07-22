TASK: Build S513b — flag "couldn't-find-a-time" leads. Make a renter who WANTED to book but
couldn't distinguishable from a generic website inquiry, so the operator can offer alternate
times and the nurture drip stops mis-nudging them to "come book" at the same thin calendar.
ONE migration (0160) + a re-created submit_public_lead RPC (one added param). Source stays
'website' (the flag is orthogonal).

════════════════════════════════════════════════════════════════════════
READ FIRST (context — repo-relative paths)
════════════════════════════════════════════════════════════════════════
Primary spec: claude/CODEX-BUILD-S513b.md
Design + rationale: claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md §4

Verified refs (2026-07-18):
  • app/r/[propertyId]/inquiry-form.tsx — client state `skipTime` (set by the "send details
    instead" link) + prop `hasSlots` (~line 109). NEITHER is submitted today.
  • app/r/[propertyId]/actions.ts — `submitLead` (~600–655) reads FormData → RPC
    submit_public_lead; the leasing.new_lead email is sent in the SAME file (~line 260,
    eventKey "leasing.new_lead", vars, resolveLeadNotifyEmailsPreferMemberFallback).
  • submit_public_lead latest def: supabase/migrations/0147_submit_public_lead_dedup.sql
    (params end at `p_custom_answers jsonb default '[]'`; stamps v_source='website';
    security definer). COPY the whole body when re-creating.
  • lib/notifications.ts — the leasing.new_lead event (tokens + default body).
  • lib/lead-detail.ts `resolveLeadSource` + app/dashboard/leads/[id]/page.tsx (lead select
    ~line 101) — where the source badge renders.
  • lib/nurture.ts `STEP_COPY` (~117) + app/api/cron/nurture/route.ts (loads leads + org
    nurture_enabled). Nurture is time-based (+2/+5/+10d), ignores availability today.

App HEAD: current main (S513a + S514 live). Latest migration: 0159. **Use 0160.**

════════════════════════════════════════════════════════════════════════
CREATE: supabase/migrations/0160_lead_no_suitable_time.sql   (Codex writes; Cowork applies)
════════════════════════════════════════════════════════════════════════
```sql
alter table public.leads
  add column if not exists no_suitable_time boolean not null default false;
```
Then RE-CREATE public.submit_public_lead: copy the ENTIRE body from 0147 verbatim and change
only two things:
  • add a trailing defaulted param: `p_no_suitable_time boolean default false`
  • in the `insert into leads (...)`, set `no_suitable_time = coalesce(p_no_suitable_time, false)`
Keep `source='website'`, the signature style, returns jsonb, security definer, search_path, and
EVERYTHING else byte-identical. (Trailing + defaulted => existing callers/tests unbroken.)

════════════════════════════════════════════════════════════════════════
MODIFY: app/r/[propertyId]/inquiry-form.tsx
════════════════════════════════════════════════════════════════════════
Submit a hidden field `no_suitable_time` = "1" when EITHER `skipTime` is true OR `hasSlots` is
false; otherwise omit/empty. When `hasSlots` is false the form already renders details-only —
emit the hidden input statically there (no-JS safe). The `skipTime` case is JS-only (fine).

════════════════════════════════════════════════════════════════════════
MODIFY: app/r/[propertyId]/actions.ts
════════════════════════════════════════════════════════════════════════
  • In submitLead: `const noSuitableTime = formData.get("no_suitable_time") === "1";` and pass
    `p_no_suitable_time: noSuitableTime` in the submit_public_lead RPC call.
  • New-lead email (~line 260): add to `vars` a `no_suitable_time_note` =
    noSuitableTime ? "⚠ This renter couldn't find a workable viewing time — offer alternate times." : ""
    (additive; empty for normal inquiries).

════════════════════════════════════════════════════════════════════════
MODIFY: lib/notifications.ts
════════════════════════════════════════════════════════════════════════
Add `no_suitable_time_note` to the leasing.new_lead event's `tokens`, and inject
`{{no_suitable_time_note}}` on its own line in that event's default body (renders when set,
collapses to nothing when empty). Do not disturb other events.

════════════════════════════════════════════════════════════════════════
MODIFY: lib/lead-detail.ts + app/dashboard/leads/[id]/page.tsx
════════════════════════════════════════════════════════════════════════
Select `no_suitable_time` in page.tsx (~line 101) + add to the lead-detail type. Render a badge
near the source label — "Wanted to book — no suitable time" — when lead.no_suitable_time. Put
the pure decision in lib/lead-detail.ts (testable); the page renders it.

════════════════════════════════════════════════════════════════════════
MODIFY: lib/nurture.ts + app/api/cron/nurture/route.ts  (the mis-nudge fix)
════════════════════════════════════════════════════════════════════════
Chosen approach: DISTINCT COPY VARIANT (no dependency on live availability; composes with the
future reopen-notify). Load `no_suitable_time` in the nurture route's leads select and thread
it into the copy pick. In the STEP_COPY selector, when `no_suitable_time` is true, return a
variant that does NOT say "come book now" but "we're lining up more viewing times and will let
you know the moment they open" (mirror existing tone/cadence). Leave normal-lead copy untouched.
(If Noam prefers "skip the step while the calendar is thin" instead, he'll say — default to the
variant.)

════════════════════════════════════════════════════════════════════════
CREATE: scripts/test-*.ts  (tsx)
════════════════════════════════════════════════════════════════════════
  • no_suitable_time round-trip: submit with hidden field → RPC param → column true; normal
    submit → false. (No DB harness? assert the RPC re-def contains the param + the column set,
    and unit-test the action's FormData→param shaping.)
  • leasing.new_lead `no_suitable_time_note` renders when set, empty otherwise.
  • nurture copy selector returns the variant for a flagged lead, normal copy otherwise.

════════════════════════════════════════════════════════════════════════
GUARDRAILS — MUST NOT
════════════════════════════════════════════════════════════════════════
  • Keep source='website' — the flag is orthogonal; do not shift source analytics.
  • RPC param MUST be trailing + defaulted; re-create submit_public_lead from the 0147 body
    verbatim except the one param + one column.
  • Normal inquiries / other orgs unaffected: no_suitable_time_note empty, badge hidden, normal
    nurture copy unchanged.
  • Do NOT build S513c (reopen-notify) here.
  • Migration to prod via Supabase MCP; Codex writes the file only.

════════════════════════════════════════════════════════════════════════
DELIVERABLE
════════════════════════════════════════════════════════════════════════
A single diff touching exactly:
  NEW:  supabase/migrations/0160_lead_no_suitable_time.sql   (column + submit_public_lead re-def)
  MOD:  app/r/[propertyId]/inquiry-form.tsx
  MOD:  app/r/[propertyId]/actions.ts
  MOD:  lib/notifications.ts
  MOD:  lib/lead-detail.ts
  MOD:  app/dashboard/leads/[id]/page.tsx
  MOD:  lib/nurture.ts
  MOD:  app/api/cron/nurture/route.ts
  NEW:  scripts/test-*.ts
Ensure the new test passes, existing notification/nurture tests still pass, and the project
typechecks (`npx tsc --noEmit`) + builds + lints.
