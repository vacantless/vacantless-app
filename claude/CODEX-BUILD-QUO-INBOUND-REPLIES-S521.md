# CODEX REVIEW+BUILD — QUO/OpenPhone inbound webhook: renter reply routing + STOP sync — S521

**Repo:** `vacantless-app`. **App HEAD:** `8d61e27`.
**Gate:** correctness fix for the CURRENT SMS path (we run QUO, `SMS_PROVIDER=quo`). Growth-level; NO new entitlement, NO Premium gate. Ships DARK (no webhook secret set) and activates only when Noam configures the QUO webhook + env.

---

## 0. Why
We send renter SMS from ONE shared QUO number, but **nothing handles inbound** to it. The only inbound route (`app/api/sms/inbound/route.ts`) is **Twilio-shaped** (verifies X-Twilio-Signature, needs `TWILIO_AUTH_TOKEN`) and handles **opt-out keywords only** — a normal conversational reply is explicitly dropped. So today a renter reply to the QUO number (a) never reaches the app (Twilio route won't validate a QUO POST), landing unrouted in the OpenPhone/QUO app inbox; and (b) even the opt-out path doesn't run for QUO, so **`leads.sms_opt_out` never syncs** and the reminder cron keeps trying to text people who said STOP. Fix: a QUO inbound webhook that verifies OpenPhone's signature, honors STOP/START into our own opt-out flag, and **logs conversational replies to the matched org's lead timeline** (+ best-effort operator notification) instead of dropping them.

## 1. REVIEW FIRST (deliver a short note, then build)
- `app/api/sms/inbound/route.ts` (Twilio) — the existing opt-out logic: `classifyInbound(body)` → stop/start; `normalizePhoneE164(from)`; SQL match on `leads.phone_e164` (+ `tenants.phone_e164`); flip `sms_opt_out`/`sms_opt_out_at` on rows that change; log opt-out to `messages` (org-scoped via `lead.organization_id`); no app-generated auto-reply. **This logic is the thing to EXTRACT + REUSE** (do not duplicate).
- `lib/sms.ts` — `classifyInbound` (l.115), `normalizePhoneE164` (l.50), `verifyTwilioSignature` (l.289; mirror its shape for OpenPhone). QUO send path already here.
- `app/api/inbound/asset/route.ts` + `app/api/stripe/webhook/route.ts` — precedents for a **dark-safe, secret-verified** webhook (no-op 200 when the secret env is unset).
- `lib/notifications-server.ts` + `lib/notifications.ts` — the per-org notification registry, for surfacing a renter reply to the operator (see §2d; confirm whether a suitable event exists or a new one is cheap).
- `messages` table shape (organization_id, lead_id, channel, direction, body) — confirm from the existing inserts.
- **Coordination:** `claude/CODEX-BUILD-CAPTURE-TEXT-IN-S518.md` (dark, not built) also proposed `app/api/quo/inbound` for maintenance MMS capture. This ticket OWNS that route for renter replies; build it with a clean seam so the future capture path can be added (dispatch), not a colliding second route. Note this in the review.

## 2. BUILD

### 2a. `lib/sms.ts` — pure OpenPhone webhook helpers (unit-tested via `npx tsx`)
Per OpenPhone/QUO webhook spec (verified 2026-07-19, support.quo.com/core-concepts/integrations/webhooks):
- `verifyOpenPhoneSignature(signingSecretBase64, signatureHeader, rawBody, { toleranceSec = 300, nowMs })`:
  - Header format `openphone-signature: hmac;1;<unixMillisTimestamp>;<base64Sig>` (may later be comma-separated multiples — split on `,` and accept if ANY matches).
  - `signedData = timestamp + "." + rawBody` (use the RAW request body string exactly as received — do NOT re-stringify the parsed JSON).
  - key = base64-decode `signingSecretBase64` to bytes; `computed = base64( HMAC_SHA256(key, signedData) )`; **constant-time** compare to the header sig.
  - Reject if timestamp is missing, malformed, or outside `toleranceSec` of now (replay guard). Inject `nowMs` so it's pure/testable.
  - Return boolean.
- `parseOpenPhoneInbound(payload)` → `{ kind: "message_received", from, to, body } | null`: return non-null ONLY when `payload.type === "message.received"` and `payload.data.object.direction === "incoming"`; else null (ignore delivered/call/contact/etc.).

### 2b. Extract the shared inbound core — `lib/sms-inbound.ts` (or similar)
Move the Twilio route's routing logic into a reusable `applyInboundSms(admin, { from, body })` and have BOTH routes call it:
- `classifyInbound(body)` → stop/start/null.
- `normalizePhoneE164(from)`; if unparseable → return early (nothing to do).
- Match `leads` (+ `tenants`) by `phone_e164 = sender` (no row cap — a STOP must never be dropped).
- **STOP/START:** flip `sms_opt_out` + `sms_opt_out_at` on rows that change; log opt-out to `messages` (org-scoped) — EXACT current behavior.
- **NEW — normal reply (`classifyInbound` null):** for each matched lead, insert a `messages` row `{organization_id, lead_id, channel:'sms', direction:'inbound', body: <the reply text, trimmed/capped>}` so it lands on the lead timeline. (Shared-number ambiguity: if the phone matches leads in >1 org, log to each — every org that texted this person sees their reply. Acceptable; note it.)
- Never send an app-generated auto-reply (carrier/OpenPhone handles STOP confirmation).
- Return a small summary (counts) for logging.

### 2c. `app/api/quo/inbound/route.ts` (POST)
- Read the RAW body text FIRST (needed for signature). `QUO_WEBHOOK_SIGNING_SECRET` unset → **200 no-op** (dark-safe, like the asset/Twilio routes).
- `verifyOpenPhoneSignature(secret, header, rawBody, {nowMs: Date.now()})` → on fail return 401 (or 200 no-op to avoid retry storms — match the asset-route posture; prefer 401 only for a present-but-bad signature, 200 when unconfigured).
- `parseOpenPhoneInbound(JSON.parse(rawBody))` → if null, **200 ack** (ignore non-inbound-message events). Else call `applyInboundSms(admin, {from, body})`.
- Always respond 2xx within 10s on success (OpenPhone retries on non-2xx/timeout).
- `export const dynamic = "force-dynamic"; runtime = "nodejs";`

### 2d. Operator surfacing (best-effort)
Primary surface = the lead-timeline `messages` row (§2b), visible in the lead view. ADDITIONALLY, if `lib/notifications-server` has (or cheaply supports) a "renter replied" event, fire a best-effort operator notification (never block/throw the webhook on it). If adding a new notification event is non-trivial, ship the timeline log now and note the operator-push as a fast-follow in your review — do NOT balloon this ticket.

### 2e. No migration
`messages`, `leads.sms_opt_out(_at)`, `tenants.sms_opt_out(_at)` all exist. **No schema change.**

## 3. CONSTRAINTS / INVARIANTS
- DARK by default: unset `QUO_WEBHOOK_SIGNING_SECRET` → 200 no-op, zero behavior change in prod until Noam configures it.
- Reuse the existing opt-out logic (extract, don't duplicate); the Twilio route must keep working via the same shared core.
- Verify signature on every acted-upon request; constant-time compare; replay guard via timestamp tolerance.
- Idempotency: OpenPhone retries — re-processing the same event must be safe (opt-out flips are idempotent; a duplicate timeline log is low-harm, but if the payload has a stable event/message `id`, prefer to guard against a duplicate `messages` insert on replay if cheap).
- No app-generated auto-reply. No new entitlement/gate. No Premium gating.
- Pure helpers (`verifyOpenPhoneSignature`, `parseOpenPhoneInbound`) have no I/O.
- Do NOT touch the reminder cron, S520 code, or the email path.

## 4. VERIFICATION (Cowork re-runs)
- New `scripts/test-sms-inbound.ts` (or extend `scripts/test-sms.ts`): `verifyOpenPhoneSignature` valid / tampered-body / wrong-key / stale-timestamp / malformed-header; `parseOpenPhoneInbound` for a real `message.received` incoming payload (use the doc's example) vs `message.delivered` / `call.*` (→ null); `classifyInbound`/routing decision: STOP → opt-out intent, normal text → timeline-log intent, unknown sender → no-op. All pass under `npx tsx`.
- `git diff --check` clean; diff confined to `lib/sms.ts`, `lib/sms-inbound.ts`, `app/api/quo/inbound/route.ts`, `app/api/sms/inbound/route.ts` (refactor to shared core), tests, and (if added) a notification event. NO migration.
- `npx tsc --noEmit`, `npm run lint`, `npm run build` green.
- **Commit + push to `main`.** No prod DB / env / webhook changes (Noam configures the QUO webhook + sets `QUO_WEBHOOK_SIGNING_SECRET`).

## 5. GO-LIVE (Noam, after merge+deploy — NOT Codex)
In QUO: Settings → Webhooks → Create webhook → URL `https://app.vacantless.com/api/quo/inbound`, event `message.received`, resource = the Vacantless number (647-559-8281), Owner/Admin. Reveal signing secret → set `QUO_WEBHOOK_SIGNING_SECRET` in Vercel (Production+Preview, Sensitive) → redeploy → "Send Test Request" from QUO to confirm 2xx + signature verify.

## 6. OUT OF SCOPE
Maintenance text-in CAPTURE (S518 ticket — extends this route later). Two-way conversational SEND from the app (renter reply → operator reply UI). Per-org dedicated numbers (Premium; `claude/DESIGN-PREMIUM-DEDICATED-SMS-SENDER-2026-07-19.md`). Voice/call events. The operator-confirmation-modes layer (separate later ticket).
