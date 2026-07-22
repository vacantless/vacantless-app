TASK: Build S513a — the same-day "availability tripwire". When an org's ACTUALLY-BOOKABLE
viewing slots for the next N days drop to ZERO or THIN, send a same-day, edge-triggered alert
to the operator AND always CC the owner_admin. This is the mid-week complement to the weekly
Sunday empty-week reminder (S500), which fires only weekly and only on a fully-empty calendar.
ONE new migration (0158, org columns only). Reuse S513-H1's shipped slot counters — do NOT
re-implement them.

════════════════════════════════════════════════════════════════════════
READ FIRST (context — repo-relative paths)
════════════════════════════════════════════════════════════════════════
Primary spec (follow it exactly; this prompt reproduces its substance):
  • claude/CODEX-BUILD-AVAILABILITY-TRIPWIRE-S513a.md
Design rationale (deeper context; §3 = A/tripwire, §8 = the locked decisions):
  • claude/DESIGN-AVAILABILITY-TRIPWIRE-AND-WAITLIST-S513.md

Existing code to IMPORT (do NOT duplicate its logic):
  • lib/leasing-health.ts   → S513-H1 SHIPPED these booked-aware, window-clamped, unit-tested
                              NAMED EXPORTS. Import them; do not rebuild them:
                                openBookableDays(av: Availability, now: Date, days: number): string[]
                                countOpenBookableSlots(av: Availability, now: Date, days: number): number
                              (Both run over generateSlots, which already excludes av.booked +
                              lead-time. They are covered by scripts/test-leasing-health.ts.)
  • lib/booking.ts          → type Availability, generateSlots (import type only).

Existing code to MODEL ON (mirror the structure; new files, don't edit these except where noted):
  • app/api/cron/leasing-snapshot/route.ts  → S513-H1's route. Its block ~lines 300–390 already
                                              loads availability_rules / availability_days_off /
                                              availability_overrides + org booking cols + real
                                              future showings, and BUILDS the Availability object
                                              with availability.booked = the real taken instants.
                                              COPY THAT ASSEMBLY. (Note the showings filter:
                                              .or("outcome.is.null,outcome.eq.scheduled"),
                                              scheduled_at >= now, < now + window.)
  • app/api/cron/viewing-reminder/route.ts  → S500 cron. MODEL the skeleton on it: authorized()
                                              CRON_SECRET check, createAdminClient, Summary type,
                                              per-org try/catch, ?dry=1 / ?force=1 / ?org=<id>.
                                              Also copy its member-load → operatorFallback block
                                              (memberships select user_id, role; resolve each
                                              email via admin.auth.admin.getUserById; then
                                              resolveLeadNotifyEmails(members, [reply_to_email,
                                              public_contact_email])). ⚠ Do NOT copy its
                                              `booked: []` — the tripwire MUST use real bookings.
  • lib/viewing-reminder.ts                 → reminderAvailability() horizon-clamp pattern (for
                                              reference only; the H1 counters already clamp).
  • lib/leasing-snapshot.ts                 → import localDateString(nowMs, tz) for the org-local
                                              "today" date used by the debounce.

Files you WILL MODIFY (see the FORCED ADMIN CC section — this is load-bearing):
  • lib/notifications.ts         → add `alwaysInclude` to resolveNotificationRecipients + register
                                   the new event.
  • lib/notifications-server.ts  → thread `alwaysInclude` through sendOrgNotification.
  • lib/leads-notify.ts          → import resolveLeadNotifyEmails + type NotifyMember (no edit).
  • .github/workflows/reminders.yml → add the every-15-min ping for the new cron.

════════════════════════════════════════════════════════════════════════
LOCKED DEFAULTS (Noam)
════════════════════════════════════════════════════════════════════════
window lookahead N = 7 days · thin threshold = < 3 bookable slots · thin-by-days = ≤ 1 open day
zero  = open < 1
thin  = open < thin_slots (3)  OR  openDays ≤ 1
ok    = otherwise
Re-alert cadence while unresolved: at most ONCE PER org-local DAY. Escalation thin→zero always
alerts. Improvement (zero→thin, →ok) never alerts.
Enable per-org (default OFF); flip Agile ON as a data step after deploy. Never globally on.

════════════════════════════════════════════════════════════════════════
FORCED ADMIN CC — the mechanism (⚠ the old draft got this wrong; do it THIS way)
════════════════════════════════════════════════════════════════════════
Requirement: the owner_admin is CC'd on EVERY tripwire alert, even if the operator has narrowed
notification_settings.recipients for this event.

Current behaviour of resolveNotificationRecipients (lib/notifications.ts) for an operator event:
    push(audienceEmail);                                  // always included
    const list = configured.length > 0 ? configured       // <-- operatorFallback is IGNORED
                                       : operatorFallback; //     whenever configured is non-empty
    list.forEach(push);
    return out.slice(0, MAX_NOTIFICATION_RECIPIENTS);
⇒ Appending the admin to operatorFallback does NOT work once the operator configures recipients.
Only audienceEmail is unconditional, and it's a single address with a specific meaning.

FIX — add a first-class "always include these" channel (additive, backward-compatible):
  1. lib/notifications.ts → resolveNotificationRecipients: add optional `alwaysInclude?: string[]`.
     For BOTH audience branches, push each alwaysInclude address (through the same push() dedup)
     BEFORE the configured/fallback list — so the MAX_NOTIFICATION_RECIPIENTS slice can never
     truncate the admin. Operator order becomes: audienceEmail → alwaysInclude[] →
     (configured else operatorFallback). Absent/empty ⇒ byte-identical to today for every caller.
  2. lib/notifications-server.ts → sendOrgNotification: add optional `alwaysInclude?: string[]`;
     pass it into the resolveNotificationRecipients({...}) call (live path AND any dry/preview path).
  3. The tripwire cron resolves admin emails from the members it already loaded:
     const adminEmails = members.filter(m => m.role === 'owner_admin')
                                .map(m => m.email).filter((e): e is string => !!e);
     and passes alwaysInclude: adminEmails to sendOrgNotification (and into the dry preview's
     resolveNotificationRecipients).
Confirm existing notification tests still pass unchanged (the change is a pure superset).

════════════════════════════════════════════════════════════════════════
CREATE: supabase/migrations/0158_availability_tripwire.sql
════════════════════════════════════════════════════════════════════════
(Codex writes the FILE ONLY; Cowork applies it to prod via Supabase MCP — do not run it.)
  alter table public.organizations
    add column if not exists availability_tripwire_enabled boolean not null default false,
    add column if not exists availability_tripwire_lookahead_days integer not null default 7,
    add column if not exists availability_tripwire_thin_slots integer not null default 3,
    add column if not exists availability_tripwire_last_state text,
    add column if not exists availability_tripwire_last_alert_on date;
No RLS change (existing org policies cover new columns). No event seed (events are code-registered).

════════════════════════════════════════════════════════════════════════
CREATE: lib/availability-tripwire.ts   (PURE — no I/O; imports H1's counters)
════════════════════════════════════════════════════════════════════════
  import { openBookableDays, countOpenBookableSlots } from "./leasing-health";
  // optionally re-export them so the cron/test can import from one place.

  export type TripwireSeverity = "ok" | "thin" | "zero";

  export function classifyTripwire(args: {
    open: number; openDays: number; thinSlots: number;
  }): TripwireSeverity;
    // zero if open < 1; else thin if open < thinSlots OR openDays <= 1; else ok.

  export function shouldAlertTripwire(args: {
    severity: TripwireSeverity;
    lastState: string | null;    // 'ok'|'thin'|'zero'|null
    lastAlertOn: string | null;  // org-local 'YYYY-MM-DD'
    todayLocal: string;          // org-local 'YYYY-MM-DD'
  }): { alert: boolean; nextLastState: TripwireSeverity; nextLastAlertOn: string | null };
    // alert when severity ∈ {thin,zero} AND
    //   (lastState ∈ {null,'ok'})                         // first-seen / fresh drop
    //   OR (lastState === 'thin' && severity === 'zero')  // escalation
    //   OR (lastState === severity && lastAlertOn < todayLocal)  // once-per-day re-alert
    // nextLastState = severity (ALWAYS).
    // nextLastAlertOn = todayLocal when alert; null when severity==='ok'; else unchanged (lastAlertOn).

════════════════════════════════════════════════════════════════════════
CREATE: app/api/cron/availability-tripwire/route.ts
════════════════════════════════════════════════════════════════════════
Skeleton mirrors viewing-reminder/route.ts (auth, admin client, Summary, per-org try/catch,
dry/force/org). Per org WHERE availability_tripwire_enabled = true:
  1. Load org cols: id, name, brand_color, logo_url, reply_to_email, public_contact_email,
     booking_timezone, booking_slot_minutes, booking_lead_hours, booking_horizon_days,
     availability_tripwire_lookahead_days, availability_tripwire_thin_slots,
     availability_tripwire_last_state, availability_tripwire_last_alert_on.
  2. Assemble `availability` (incl. availability.booked = real taken instants) EXACTLY like the
     H1 snapshot route (~lines 300–390): load rules/days_off/overrides + future scheduled showings
     for the org over N days, build the Availability object. N = lookahead_days (default 7).
  3. open = countOpenBookableSlots(av, now, N); openDays = openBookableDays(av, now, N).length.
     severity = classifyTripwire({ open, openDays, thinSlots: thin_slots }).
  4. todayLocal = localDateString(now.getTime(), tz). decision = shouldAlertTripwire({ severity,
     lastState: last_state, lastAlertOn: last_alert_on, todayLocal }).  ?force=1 ⇒ force alert=true
     (still requires enabled). ?dry=1 ⇒ compute + report, NO writes, NO sends.
  5. Recipients: members-load block (copy S500's) → operatorFallback; adminEmails from
     members.filter(role==='owner_admin'). vars = { org_name, open_slots:String(open),
     open_days:String(openDays), window_days:String(N), viewing_times_url:`${APP_URL}/dashboard/availability` }.
  6. If decision.alert (or force): sendOrgNotification({ client, org, eventKey:
     'leasing.viewing_availability_dropped', vars, operatorFallback, alwaysInclude: adminEmails,
     action:{ label:'Set your viewing times', url:`${APP_URL}/dashboard/availability` } }).
  7. If NOT dry: update organizations set availability_tripwire_last_state = decision.nextLastState,
     availability_tripwire_last_alert_on = decision.nextLastAlertOn where id = org.id.
     (Write state EVERY non-dry run, even when severity is ok / no alert.)
  8. Dry branch: load the notification_settings row, render, and call resolveNotificationRecipients
     with the SAME alwaysInclude: adminEmails so the reported `recipients` already includes the admin;
     report { org, severity, open, open_days, would_send, recipients }.

════════════════════════════════════════════════════════════════════════
MODIFY: lib/notifications.ts
════════════════════════════════════════════════════════════════════════
  • resolveNotificationRecipients: the `alwaysInclude` addition (see FORCED ADMIN CC).
  • Register the event:
      key: "leasing.viewing_availability_dropped",  audience: "operator",
      subject default: "Heads up — {{org_name}} has almost no bookable viewing times"
      body default (URGENT mid-week tone — distinct from the weekly reminder so an operator with
      BOTH on never sees two identical emails):
        "{{org_name}} currently has {{open_slots}} bookable viewing slot(s) across {{open_days}}
        day(s) in the next {{window_days}} days. Renters may be hitting the booking page and
        finding nothing that works. Open more times so viewings keep flowing."
      tokens: org_name, open_slots, open_days, window_days, viewing_times_url.

════════════════════════════════════════════════════════════════════════
MODIFY: lib/notifications-server.ts
════════════════════════════════════════════════════════════════════════
  • sendOrgNotification: add optional `alwaysInclude?: string[]`; thread into
    resolveNotificationRecipients({ audience, configured, operatorFallback, alwaysInclude }).

════════════════════════════════════════════════════════════════════════
MODIFY: .github/workflows/reminders.yml
════════════════════════════════════════════════════════════════════════
Add a step mirroring "Trigger viewing-reminder sweep":
  - name: Trigger availability-tripwire sweep
    run: |
      curl -sS -X GET \
        -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
        "https://vacantless-app.vercel.app/api/cron/availability-tripwire" \
        -w "\nHTTP %{http_code}\n"

════════════════════════════════════════════════════════════════════════
CREATE: scripts/test-availability-tripwire.ts   (tsx; must pass under `npx tsx`)
════════════════════════════════════════════════════════════════════════
  • classifyTripwire: zero (open=0) ; thin-by-count (open=2, openDays=3, thinSlots=3) ;
    thin-by-days (open=4, openDays=1) ; ok (open=5, openDays=3, thinSlots=3).
  • shouldAlertTripwire transition table:
      null→thin ⇒ alert, nextLastState 'thin', nextLastAlertOn today
      ok→thin   ⇒ alert
      thin→thin same day (lastAlertOn==today) ⇒ NO alert
      thin→thin next day (lastAlertOn<today)  ⇒ alert
      thin→zero ⇒ alert (escalation)
      zero→ok   ⇒ NO alert, nextLastAlertOn null
      ok→zero   ⇒ alert
      zero→thin ⇒ NO alert (improvement)
  • (Counters are already covered by scripts/test-leasing-health.ts; you MAY add one assertion
    that the imports resolve, but don't re-test them.)

════════════════════════════════════════════════════════════════════════
ALSO ADD A CASE TO: the existing notifications recipient test
════════════════════════════════════════════════════════════════════════
(Find the test that exercises resolveNotificationRecipients — likely scripts/test-notifications*.ts.)
Assert that with audience 'operator', a NON-EMPTY `configured` list, AND `alwaysInclude:[admin]`:
the admin appears in the output, is deduped if also configured, and is ordered ahead of the
configured entries (never dropped by the recipient cap).

════════════════════════════════════════════════════════════════════════
GUARDRAILS — MUST NOT
════════════════════════════════════════════════════════════════════════
  • Do NOT re-implement the bookable-slot counters — import openBookableDays /
    countOpenBookableSlots from lib/leasing-health.ts.
  • Do NOT pass booked: [] — the tripwire is worthless if it ignores real bookings.
  • Do NOT touch the S500 viewing-reminder cron, lib/viewing-reminder.ts, the H1 snapshot route's
    behaviour, lib/leasing-health.ts logic (import only), or any booking RPC.
  • Do NOT send on improvement, and do NOT level-trigger (no alert every 15 min while thin) — the
    debounce is the whole point.
  • The alwaysInclude change MUST be a pure superset: with it absent, every existing notification
    send is byte-identical (confirm via existing notification tests).
  • Keep lib/availability-tripwire.ts 100% pure (all supabase I/O stays in the cron route).
  • ?dry=1 MUST be fully side-effect-free (no state writes, no sends).
  • Codex writes supabase/migrations/0158_*.sql but does NOT apply it (Cowork applies via Supabase MCP).

════════════════════════════════════════════════════════════════════════
DELIVERABLE
════════════════════════════════════════════════════════════════════════
A single diff touching exactly:
  NEW:  supabase/migrations/0158_availability_tripwire.sql
  NEW:  lib/availability-tripwire.ts
  NEW:  app/api/cron/availability-tripwire/route.ts
  NEW:  scripts/test-availability-tripwire.ts
  MOD:  lib/notifications.ts
  MOD:  lib/notifications-server.ts
  MOD:  .github/workflows/reminders.yml
  MOD:  the existing notifications recipient test (one added case)
Ensure `npx tsx scripts/test-availability-tripwire.ts` passes, the existing notification test
still passes, and the project typechecks (`npx tsc --noEmit`) + builds.
