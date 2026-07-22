TASK: Build S513c — auto-notify waiting leads when viewing times reopen. When an operator opens
new bookable viewing capacity, the leads flagged `no_suitable_time` (S513b) get ONE renter-facing
"new viewing times just opened for {address} — book here" email automatically. ONE migration (0162,
two nullable columns) + a new cron + a new pure module + an additive email fn + three one-line
stamps in the availability save actions + one pinger line. NO RPC. NO operator notification event.

════════════════════════════════════════════════════════════════════════
★ THE ONE DECISION THAT MUST NOT DRIFT
════════════════════════════════════════════════════════════════════════
The "reopen" signal is "the operator ADDED bookable capacity," NOT "the tripwire recovered."
Do NOT key this off the S513a tripwire's zero/thin→ok recovery edge. Basma's org was 'ok' the
whole time (11 slots / 2 open days, never tripped) yet she is exactly the waiting lead this
notifies. Trigger = a capacity-ADDING availability save stamps
`organizations.availability_reopened_at = now()`; a sweep notifies waiting leads whose last notify
predates that stamp, GUARDED by "there are open bookable slots right now." Independent of tripwire
severity and of `availability_tripwire_enabled`.

════════════════════════════════════════════════════════════════════════
READ FIRST (context — repo-relative paths)
════════════════════════════════════════════════════════════════════════
Primary spec: claude/CODEX-BUILD-REOPEN-NOTIFY-S513c.md
Design + rationale: claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md §5 (C)

Verified refs (2026-07-18):
  • app/dashboard/availability/actions.ts — capacity-ADDING (stamp these 3): addAvailabilityWindow
    (~116), addAvailabilityOverride (~224), removeDayOff (~210). Capacity-REMOVING (do NOT stamp):
    deleteAvailabilityWindow, addDayOff, removeAvailabilityOverride. Each action ends
    revalidatePath+redirect and fires no notification today.
  • lib/availability-tripwire.ts — re-exports countOpenBookableSlots / openBookableDays. REUSE
    countOpenBookableSlots for the "open now" guard; do not rebuild a counter.
  • app/api/cron/availability-tripwire/route.ts — COPY its availability-load block (Promise.all over
    availability_rules / availability_days_off / availability_overrides / future showings
    [outcome.is.null,outcome.eq.scheduled; scheduled_at ≥ now, < now+N; asc] → build the Availability
    object), its authorized()/createAdminClient()/safeErrorMessage(), per-org try/catch + stage
    tracker, and ?dry/?force/?org handling.
  • app/api/cron/nurture/route.ts — COPY its lead-select shape (status in NURTURABLE_STATUSES,
    created_at > now-NURTURE_MAX_AGE_MS, join properties(status,address,rent_cents)+organizations(...),
    per-row try/catch, insert into messages a timeline note). Reuse NURTURABLE_STATUSES +
    NURTURE_MAX_AGE_MS from lib/nurture.ts.
  • lib/email.ts — sendNurtureEmail (~1292) + sendWaitlistVacancyAlert (~1161) are the renter-facing
    pattern. Reuse APP_BASE_URL, DEFAULT_SENDER_EMAIL, BREVO_ENDPOINT, DEFAULT_BRAND_COLOR,
    replyToOf(), firstName(), escapeHtml(), listingUrl(propertyId) [=${APP_BASE_URL}/r/${enc}, ~971],
    SendResult. Add no new transport.
  • .github/workflows/reminders.yml — the every-15-min pinger; availability-tripwire step ~line 86;
    add the new step right after, same curl -sS -X GET + Bearer CRON_SECRET shape.
  • leads.reopen_notified_at + organizations.availability_reopened_at DO NOT EXIST yet → mig 0162.

App HEAD: `229e110` (main; S513a/S514/S513b/S515/S515b live). Latest migration on disk: 0161.
**Use 0162.**

════════════════════════════════════════════════════════════════════════
CREATE: supabase/migrations/0162_reopen_notify.sql   (Codex writes; Cowork/Noam applies)
════════════════════════════════════════════════════════════════════════
```sql
alter table public.leads
  add column if not exists reopen_notified_at timestamptz;
alter table public.organizations
  add column if not exists availability_reopened_at timestamptz;
```
No RLS change, no RPC. Both nullable.

════════════════════════════════════════════════════════════════════════
MODIFY: app/dashboard/availability/actions.ts  (stamp the reopen)
════════════════════════════════════════════════════════════════════════
In EXACTLY addAvailabilityWindow, addAvailabilityOverride, removeDayOff — after the successful
insert/delete, before revalidatePath — set the org's availability_reopened_at = now():
  await supabase.from("organizations")
    .update({ availability_reopened_at: new Date().toISOString() }).eq("id", orgId);
addAvailabilityWindow + addAvailabilityOverride already have `org = await getCurrentOrg()` + `supabase
= createClient()` → reuse, stamp after the insert with `.eq("id", org.id)`. removeDayOff has NO
getCurrentOrg() today (resolves org via RLS on the delete) → add `const org = await getCurrentOrg();
if(!org) return;` at its top (requireCapability already present), stamp after the delete. A stamp
error must log-and-continue, never break the save. Do NOT stamp in the capacity-removing actions or
in updateBookingSettings / updateClusteringSettings / setAllowDoubleBooking.

════════════════════════════════════════════════════════════════════════
CREATE: lib/availability-reopen.ts   (pure, unit-testable — house style: pure logic first)
════════════════════════════════════════════════════════════════════════
Export:
  • isReopenLeadEligible({ noSuitableTime, status, propertyStatus, createdAtMs, nowMs,
    reopenNotifiedAtMs, reopenedAtMs }): boolean
    → true iff noSuitableTime && status ∈ NURTURABLE_STATUSES && propertyStatus==='available'
      && (nowMs-createdAtMs) ≤ NURTURE_MAX_AGE_MS && reopenedAtMs!=null
      && (reopenNotifiedAtMs==null || reopenNotifiedAtMs < reopenedAtMs)
  • REOPEN_NOTIFY_MAX_PER_ORG = 25
  • reopenLeadsToNotify<T>(open: number, eligible: T[]): T[]  → [] when open<1, else first 25.
Import NURTURABLE_STATUSES + NURTURE_MAX_AGE_MS from lib/nurture.ts (do not redefine).

════════════════════════════════════════════════════════════════════════
CREATE: app/api/cron/availability-reopened-notify/route.ts   (the sweep)
════════════════════════════════════════════════════════════════════════
dynamic="force-dynamic"; runtime="nodejs". authorized()/admin client as tripwire.
Params: force (bypasses only the reopen_notified_at freshness gate, NOT the open-slots guard),
dry (render/report, no send/stamp), org (?org=).
1. Select candidate leads (nurture shape): no_suitable_time=true, status in NURTURABLE_STATUSES,
   created_at > now-NURTURE_MAX_AGE_MS, join properties(status,address,rent_cents) +
   organizations(id,name,brand_color,logo_url,reply_to_email,availability_reopened_at).
2. Group by org; skip orgs with null availability_reopened_at; filter leads via isReopenLeadEligible.
3. Load availability once per candidate org (tripwire load block); open =
   countOpenBookableSlots(availability, now, lookaheadDays) with lookaheadDays =
   org.availability_tripwire_lookahead_days ?? 7. toNotify = reopenLeadsToNotify(open, eligible).
   open<1 ⇒ toNotify empty (mandatory guard; force does NOT bypass).
4. Per lead (try/catch): sendViewingTimesOpenedEmail(...); on sent → update leads set
   reopen_notified_at=now() (RECOMMENDED also nurture_last_sent_at=now() to avoid a same-window
   nurture+reopen double email; does not advance the step) + insert messages timeline note
   'Notified — new viewing times opened'. On failure: count error, do NOT stamp (retry next sweep).
5. Return the standard Summary; console.log per-org + final summary in the tripwire route's style.

════════════════════════════════════════════════════════════════════════
MODIFY: lib/email.ts   (sendViewingTimesOpenedEmail)
════════════════════════════════════════════════════════════════════════
Add sendViewingTimesOpenedEmail(p):Promise<SendResult> mirroring sendNurtureEmail. Payload:
{lead_id, property_id, renter_name, renter_email, org_name, brand_color, logo_url, reply_to_email,
property_address, rent_cents}. Branded shell (logo if set, brand=brand_color||DEFAULT_BRAND_COLOR,
firstName, escapeHtml everything). Reply-To = replyToOf(reply_to_email, org_name). CTA →
listingUrl(property_id) — plain /r link, NO invented tracking param. Subject "New viewing times
just opened" + (address? " — "+address : ""). One warm lead line + one CTA ("Book a viewing").
Same no_api_key/no_renter_email guards + fetch try/catch + SendResult as the siblings.

════════════════════════════════════════════════════════════════════════
MODIFY: .github/workflows/reminders.yml   (pinger entry)
════════════════════════════════════════════════════════════════════════
After the availability-tripwire step (~line 86), same shape:
      - name: Trigger availability-reopened-notify sweep
        run: |
          curl -sS -X GET \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "https://vacantless-app.vercel.app/api/cron/availability-reopened-notify" \
            -w "\nHTTP %{http_code}\n"

════════════════════════════════════════════════════════════════════════
CREATE: scripts/test-availability-reopen.ts   (tsx, runs in the cloud)
════════════════════════════════════════════════════════════════════════
Pure tests on lib/availability-reopen.ts: eligibility positive + each negative in isolation (not
flagged; status booked/lost; property not available; older than NURTURE_MAX_AGE_MS;
availability_reopened_at null; reopen_notified_at ≥ reopened_at). Once-per-reopen (stamp
reopen_notified_at=reopened_at+1 ⇒ ineligible; newer reopened_at ⇒ eligible again). Open guard
(reopenLeadsToNotify(0,…)=[]; (5,…)=capped). Cap (40 eligible ⇒ length===25).

════════════════════════════════════════════════════════════════════════
GUARDRAILS — MUST NOT
════════════════════════════════════════════════════════════════════════
  • Trigger on capacity ADDED, never on the tripwire recovery edge. Stamp only the 3 add actions.
  • The open-slots guard is mandatory; force=1 must NOT bypass it.
  • Once per reopen via reopen_notified_at vs availability_reopened_at; stamp only on successful
    send; cap ≤ 25/org/sweep.
  • Renter-facing email via lib/email.ts + replyToOf — NOT a lib/notifications.ts event.
  • Reuse countOpenBookableSlots / NURTURABLE_STATUSES / NURTURE_MAX_AGE_MS / listingUrl / replyToOf
    / escapeHtml / firstName — no duplicate counter/transport/constant.
  • Do NOT touch shipped lib/availability-tripwire.ts, its cron, or the S513b RPC/columns.
  • Codex writes the migration file only; do NOT apply it. Push is Noam's.

════════════════════════════════════════════════════════════════════════
DELIVERABLE
════════════════════════════════════════════════════════════════════════
A single diff touching exactly:
  NEW:  supabase/migrations/0162_reopen_notify.sql
  MOD:  app/dashboard/availability/actions.ts
  NEW:  lib/availability-reopen.ts
  NEW:  app/api/cron/availability-reopened-notify/route.ts
  MOD:  lib/email.ts
  MOD:  .github/workflows/reminders.yml
  NEW:  scripts/test-availability-reopen.ts
Ensure the new test passes, existing tripwire/nurture/notification tests still pass, and the
project typechecks (npx tsc --noEmit) + builds + lints.
