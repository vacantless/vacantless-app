# CODEX PROMPT — Tenant-comms hardening: scheduled-send + undo-window (S611, Wave 2 lane 1)

**Repo:** `vacantless-app` (active on-disk repo; build against HEAD `a70f30f` = prod main).
**Lane discipline:** ONE file-disjoint lane. Additive only. **Dark by default** behind a master env flag — when the flag is unset, every existing code path must behave EXACTLY as today (this is warm-verified by diffing against a prod clone; a behavioral change while dark = reject).

---

## 1. What we're building & why

The direct operator→tenant send (`sendTenantMessage` in `app/dashboard/tenancies/comms-actions.ts`) fans out **inline and immediately**, then logs to `tenant_messages` + `tenant_message_deliveries`. There is no way to (a) schedule a message for later, or (b) take back a message you just sent. In a comms-first product, a mis-sent tenant message is the expensive kind of mistake. This lane adds both, sharing one durable **outbox** mechanism.

Note: the existing `pending_tenant_messages` queue (mig 0075, `lib/tenant-message-approvals.ts`) is the *approval* queue for **trigger-drafted** messages needing human approval. It is a DIFFERENT concern — **do not reuse or modify it**. This lane is about **operator-composed** messages that are already approved (the operator wrote them) but should fire later or be cancelable.

### Two capabilities, one mechanism
1. **Scheduled send** — operator picks a future date/time; the message sits in the outbox and the cron dispatches it when due. Cancelable anytime before dispatch.
2. **Undo-window** (model: **client hold + cron backstop**) — on a normal "send now", the browser shows "Sending in Ns — Undo" and only fires the real send after the window. The message is ALSO persisted to the outbox at the moment of send, so if the tab closes mid-window the 15-min cron still delivers it (never lost). Undo cancels before dispatch.

---

## 2. Dark-by-default contract (non-negotiable)

- Master switch: `process.env.TENANT_COMMS_OUTBOX_ENABLED === "true"` (mirror the house `X_ENABLED === "true"` convention, e.g. `lib/facebook-page-oauth.ts`). Default off.
- Expose a tiny reader `tenantCommsOutboxEnabled()` in the new `lib/tenant-comms-schedule.ts`.
- When OFF:
  - `sendTenantMessage` behaves **identically to today** (inline immediate send + same redirect). No new branches taken.
  - The composer renders **identically to today** — no "Send later", no undo bar. The page must pass `schedulingEnabled={false}` and the composer must early-return its current markup for that case.
  - The tenancy page renders no "Scheduled messages" section.
  - The cron endpoint exists but, finding the flag off, returns `{ ok: true, skipped: "disabled" }` without scanning. (Still CRON_SECRET-gated.)
- The migration is **purely additive** — one new table, zero changes to existing tables/columns/RLS. This is what makes "provably unchanged when dark" true.
- Do **not** touch `SETTINGS_ORG_FEATURES` or the entitlements admin UI (KI985 — the caught S610 leak). Per-org wiring via `isFeatureEnabledForOrg` is an explicit OPTIONAL follow-up, NOT this lane.

---

## 3. Files (file-disjoint; NEW unless marked MODIFY)

### 3a. `supabase/migrations/0203_scheduled_tenant_messages.sql` (NEW)
Create `public.scheduled_tenant_messages` (the operator-composed outbox). Follow the house style: `status` as a **CHECK** (not a pg enum), mirrored in the pure lib; org-scoped RLS.

Columns:
- `id uuid primary key default gen_random_uuid()`
- `organization_id uuid not null references public.organizations(id) on delete cascade`
- `tenancy_id uuid not null references public.tenancies(id) on delete cascade`
- `channel text not null check (channel in ('email','sms','both'))`
- `subject text` (nullable — email only)
- `body text not null`
- `recipient_ids uuid[] not null` (the selected tenant ids; deliveries are re-planned at dispatch)
- `scheduled_send_at timestamptz not null`
- `status text not null default 'scheduled' check (status in ('scheduled','sending','sent','canceled','failed'))`
- `origin text not null default 'scheduled' check (origin in ('scheduled','undo'))` (analytics/debug; 'undo' rows are the short-window ones)
- `created_by uuid` (auth user id; nullable)
- `sent_message_id uuid references public.tenant_messages(id) on delete set null` (set at dispatch)
- `attempts int not null default 0`
- `error text`
- `created_at timestamptz not null default now()`
- `canceled_at timestamptz`
- `dispatched_at timestamptz`

Indexes:
- Partial dispatch index: `on (scheduled_send_at) where status in ('scheduled','sending')`.
- UI index: `on (organization_id, tenancy_id, created_at desc)`.

RLS (mirror the existing tenancy-CRUD RLS in this repo — check `pending_tenant_messages` 0075 and the tenancies policies for the exact `organization_id` membership predicate used here):
- Enable RLS.
- Org members (same predicate as `tenant_messages`/tenancies) may `select`, `insert`, and `update` (for cancel) their org's rows.
- The cron dispatches via the **service-role admin client** (bypasses RLS) — no anon/user dispatch policy needed.

### 3b. `lib/tenant-comms-schedule.ts` (NEW, pure — no DB/env/I-O except the one env reader)
Pure domain model + tiny env reader. Unit-testable via `npx tsx`.
- `export const UNDO_WINDOW_SECONDS = 30` (the client hold window).
- `export const MAX_SCHEDULE_HORIZON_DAYS = 90`.
- `export function tenantCommsOutboxEnabled(env = process.env): boolean` → `env.TENANT_COMMS_OUTBOX_ENABLED === "true"`.
- `ScheduledMessageStatus` type + `SCHEDULED_MESSAGE_STATUSES` mirroring the CHECK.
- `export function canCancel(status): boolean` → only `'scheduled'`.
- `export function isDue(scheduledSendAtMs, nowMs): boolean`.
- `export function validateScheduledSendAt(input, nowMs): { ok:true; value:{ atMs:number } } | { ok:false; code:'invalid'|'in_past'|'too_far' }` — parse, must be strictly future (allow a small skew, e.g. ≥ now+1000ms), and ≤ now + horizon.
- Keep it I/O-free so `scripts/test-tenant-comms-schedule.ts` can exercise it.

### 3c. `lib/tenant-comms-dispatch.ts` (NEW — the extracted send-core)
Extract the "plan → send per channel → log to `tenant_messages` + `tenant_message_deliveries`" core out of `sendTenantMessage` so BOTH the inline action and the cron call ONE implementation (no divergence). Signature roughly:

```ts
export async function dispatchTenantMessage(args: {
  supabase: SupabaseClientLike;      // user client (RLS) OR admin client
  org: { id; name; plan; sms_enabled; brand_color; logo_url; reply_to_email;
         public_contact_email; public_contact_phone };
  tenancyId: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  recipientIds: string[];
  sentBy: string | null;
}): Promise<{ ok: boolean; messageId: string | null;
              sent: number; failed: number; skipped: number }>
```

- Reuse the SAME pure helpers already imported by the action: `planDeliveries`, `applySmsEntitlement`, `isSendable`, `renderForRecipient`, `buildTenantSmsBody`, plus `canUseSms` / `smsLive` gating. Load the tenancy + tenants + property with the SAME select the action uses.
- Re-plan against the CURRENT tenants (a tenant removed since scheduling is naturally filtered by `isSendable`); re-check SMS entitlement at dispatch (plan/sms_enabled may have changed).
- Insert the `tenant_messages` parent + `tenant_message_deliveries` rows exactly as today.
- Then refactor `sendTenantMessage` to call this core for its inline path (behavior byte-for-byte identical when the flag is off — the redirect + `?msg=` outcome codes must be unchanged).

### 3d. `app/dashboard/tenancies/comms-actions.ts` (MODIFY)
Keep `sendTenantMessage` as the entry point. Add branching **only when `tenantCommsOutboxEnabled()`**:
- New hidden field `send_mode` ∈ `{ "now", "later" }` (default "now") and `scheduled_send_at` (ISO string, present only for "later").
- `send_mode === "later"` → `validateScheduledSendAt`; on ok insert an outbox row (`origin='scheduled'`, `status='scheduled'`, `scheduled_send_at`, `recipient_ids`, `created_by=user.id`); redirect `?msg=scheduled`. On invalid → redirect `?msg=schedule_invalid`.
- `send_mode === "now"` with the flag ON → still send inline via `dispatchTenantMessage` (the undo hold is CLIENT-side; the client uses the separate enqueue/flush actions below, so the plain server-action "now" path stays a normal inline send for no-JS / fallback).

Add three **non-redirecting** server actions (return plain JSON, `"use server"`), used by the composer's client undo flow:
- `enqueueTenantMessageForUndo(payload) → { id }` — validates + inserts an outbox row `origin='undo'`, `status='scheduled'`, `scheduled_send_at = now + UNDO_WINDOW_SECONDS`. Returns the row id. (Guard: `requireCapability("manage_tenancies")`, `getCurrentOrg`, same input validation as `sendTenantMessage`.)
- `flushScheduledTenantMessage(id) → { ok, outcome }` — **atomic claim** then dispatch: `update ... set status='sending' where id=? and organization_id=? and status='scheduled' returning *`; if no row claimed → `{ ok:true, outcome:'already' }` (someone/cron beat us — never double-send). If claimed, load org, call `dispatchTenantMessage`, set `status='sent'`, `sent_message_id`, `dispatched_at`. On throw → `status='failed'`, `error`, `attempts+1`.
- `cancelScheduledTenantMessage(id) → { ok, canceled }` — `update ... set status='canceled', canceled_at=now() where id=? and organization_id=? and status='scheduled'`; report whether a row changed (false = too late, already dispatching/sent).

All three are org-scoped (getCurrentOrg + membership) and must never act on another org's row.

### 3e. `app/api/cron/tenant-message-outbox/route.ts` (NEW)
The durable backstop + the dispatcher for explicit scheduled sends. Mirror `app/api/cron/rent-increase/route.ts` structure exactly:
- `export const dynamic = "force-dynamic"; export const revalidate = 0; export const runtime = "nodejs";`
- CRON_SECRET gate (Bearer header OR `?secret=`), same helper the other crons use.
- If `!tenantCommsOutboxEnabled()` → `return NextResponse.json({ ok: true, skipped: "disabled" })`.
- Select due rows via the **admin client**: `status='scheduled' AND scheduled_send_at <= now()`, oldest first, `limit 50`.
- For each row: **atomic claim** (`update ... set status='sending' where id=? and status='scheduled' returning *`; skip if not claimed), load the org (admin select), call `dispatchTenantMessage` with the admin client + `sentBy=created_by`, then set `status='sent'`, `sent_message_id`, `dispatched_at`. On throw → `status='failed'`, `error`, `attempts+1` (no auto-retry in v1; `attempts` is for observability).
- Test affordances mirroring the house pattern (all CRON_SECRET-gated): `?org=<id>` (limit to one org), `?dry=1` (return the due rows WITHOUT claiming/sending), `?force=1` (ignore the `scheduled_send_at<=now` gate for a targeted send in QA).
- Idempotent + safe at the every-15-min cadence.

### 3f. `.github/workflows/reminders.yml` (MODIFY)
Add ONE curl step (copy an existing block verbatim) pinging `/api/cron/tenant-message-outbox` with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`. Add its name to the header comment list.

### 3g. `components/tenant-message-composer.tsx` (MODIFY)
Add props `schedulingEnabled: boolean` and `undoSeconds: number`. When `schedulingEnabled === false`, render **exactly today's markup** (early path — no behavioral change).
When enabled:
- A "Send now" / "Send later" segmented control. "Send later" reveals a `datetime-local` input (`min` = now+1 min, `max` = now + 90 days) and posts the form with `send_mode="later"` + `scheduled_send_at` (ISO). This is a normal form POST → `sendTenantMessage` → redirect `?msg=scheduled`.
- "Send now": intercept submit client-side (`onSubmit` preventDefault, use `useTransition`). Call `enqueueTenantMessageForUndo` with the composed payload → get `{ id }` → render a "Sending in {n}s — Undo" bar counting down from `undoSeconds`. On countdown end (tab still open) → call `flushScheduledTenantMessage(id)` and then show sent/navigate. On "Undo" click → `cancelScheduledTenantMessage(id)` and restore the composer. (Durability: even if the user closes the tab before the countdown ends, the row is already in the outbox and the cron will send it.)
- Keep the existing per-recipient preview + channel-lock + SMS-upsell logic unchanged.

### 3h. `app/dashboard/tenancies/[id]/page.tsx` (MODIFY)
- Pass `schedulingEnabled={tenantCommsOutboxEnabled()}` and `undoSeconds={UNDO_WINDOW_SECONDS}` to the composer.
- When enabled, add an additive **"Scheduled messages"** section for this tenancy: select `scheduled_tenant_messages where tenancy_id=? and status='scheduled' order by scheduled_send_at`, render each with its send time + channel + a **Cancel** button wired to `cancelScheduledTenantMessage`. (Undo-origin rows with a 30s window will usually be gone before this renders; that's fine — the section is mainly for real scheduled sends.)

### 3i. `scripts/test-tenant-comms-schedule.ts` (NEW)
Unit-test the pure module (`validateScheduledSendAt` future/past/too-far, `isDue`, `canCancel` status machine, `tenantCommsOutboxEnabled` env parse). House pattern: plain `tsx` script, assert + non-zero exit on failure, print `N/0`.

---

## 4. Concurrency & safety (call out explicitly in the build)
- **No double-send.** The only mutation that sends is a dispatch AFTER an atomic `status: scheduled → sending` claim. The client-flush path and the cron path both claim; whoever loses the race gets zero rows back and no-ops. Verify this is a single conditional UPDATE, not a read-then-write.
- **Org isolation.** Every action/query filters `organization_id`. The cron loads each row's own org.
- **Failure logging is per-delivery, as today** — a partial send (some recipients fail) still writes the `tenant_messages` + deliveries rows via the shared core; the outbox row is marked `sent` (the audit trail lives in the delivery rows, matching the inline path's semantics). Only a thrown error marks the outbox row `failed`.

## 5. Acceptance criteria
1. Flag OFF: `git diff` of runtime behavior is inert — composer, `sendTenantMessage`, tenancy page all identical to `a70f30f`; cron returns `skipped:"disabled"`. (Warm-verify will diff against a prod clone.)
2. Flag ON, "Send later": row lands in `scheduled_tenant_messages` (`origin='scheduled'`), nothing sent yet; cron at/after the time dispatches once, writes `tenant_messages` + deliveries, flips `status='sent'`; Cancel before the time prevents the send.
3. Flag ON, "Send now": undo bar appears; Undo → row `canceled`, zero deliveries; letting it ride → sent once (client flush), NOT twice when the cron also runs.
4. Tab-close durability: an undo-origin row left `scheduled` is dispatched by the cron within one cadence, exactly once.
5. `npx tsx scripts/test-tenant-comms-schedule.ts` passes; existing `scripts/test-tenant-comms.ts` (and any current tenant-comms tests) still pass.
6. Migration 0203 applies cleanly and is additive-only.

## 6. Out of scope (do NOT build)
- Per-org `isFeatureEnabledForOrg` wiring / any `SETTINGS_ORG_FEATURES` change (KI985).
- Editing a scheduled message in place (cancel + recompose is the v1 story).
- Touching `pending_tenant_messages` / the approval queue / triggered drips.
- Retry/backoff beyond the `attempts` counter.
- Attachments, recurring sends, timezone pickers (use the operator's local time via `datetime-local`; store UTC).

## 7. Warm-verify checklist (for Cowork, post-build, against a prod clone)
- Diff every MODIFY file vs `a70f30f`; confirm flag-off branches are unreachable/inert.
- Confirm migration 0203 touches no existing object; apply on the clone + read back the table/indexes/RLS.
- Grep that the atomic claim is a conditional UPDATE (no read-then-write send).
- Confirm `.github/workflows/reminders.yml` gained exactly one curl step, secret-bearer identical to siblings.
- Run the pure test + existing tenant-comms tests green before any push.
