# CODEX BUILD — S507: QUO/OpenPhone SMS provider backend for `lib/sms.ts`

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-07-17 · **FINALIZED:** 2026-07-19 (S517)
**Type:** additive provider backend (no behavior change until explicitly configured)
**Migration:** none
**Risk:** low — default provider stays Twilio; renter SMS remains dark for every org until creds + `sms_enabled` + plan entitlement all line up.

---

## ✅ FINALIZED 2026-07-19 (S517) — GO with QUO; the corporation is NOT a blocker

Decision (Noam, S517): activate renter SMS now via **QUO (formerly OpenPhone)**, ahead of incorporating. Research confirmed the wall Noam expected (Twilio needing a Business Profile + CRA BN) does **not** apply to the QUO sole-proprietor path:

- **QUO supports sole-proprietor A2P 10DLC registration — no EIN / corporation required.** An individual registers with: a Canadian address, a working +1 mobile, personal ID details (name + DBA/"business" name), industry, sample messages, and how SMS consent is collected. [verified 2026-07-19 via quo.com/blog/what-is-a2p-10dlc]
- **Cost/timeline:** one-time ~US$19.50 (carrier review) + ~US$2/mo; ~5–7 business days to approve (occasionally +7–10). Rejection re-submit ~US$15.
- **Sole-prop send caps:** one QUO number for US texting, ~3,000 segments/day (≤1,000 to T-Mobile). **Far above Agile's renter-reminder volume** — not a real constraint for the transactional use case (24h/2h viewing reminders + waitlist notify).
- **Flexibility hedge:** the registry design below already makes **Telnyx / Plivo** a one-entry add (proper SMS API, lower per-segment cost, also support sole-prop 10DLC). QUO gets us live fastest; we can swap or add later with zero call-site change. Do NOT rebuild for that now.

**Noam's setup checklist (the human/creds steps — Cowork can't hold secrets):**
1. Create a QUO account; get a dedicated Vacantless/Agile QUO number (NOT a number registered to another brand — A2P registration is brand-scoped).
2. Complete the **sole-proprietor** A2P 10DLC registration (address + mobile + ID + sample messages + consent method). Use real renter-reminder samples (the 24h/2h viewing reminder copy) as the message samples.
3. Once approved, grab the QUO **API key** + the number (E.164) or phone-number ID.
4. Set the Vercel env vars in the "Env vars" section below and redeploy. Nothing texts until an org also has `sms_enabled=true` on Growth+.
5. Tell Cowork when creds are in Vercel → go-live smoke test via the waitlist-notify path to a controlled number (SMS stays OFF for Agile's renters until Noam's explicit go).

Everything below is the unchanged build spec (Codex builds `lib/sms.ts` provider seam; ready the moment creds land).

---

## Why

Renter SMS is built and correct but dark: `lib/sms.ts` sends via Twilio, and Twilio toll-free needs a Business Profile + CRA business number Noam doesn't have (`feedback_twilio_sms_not_configured`). **QUO (formerly OpenPhone)** clears that wall — it handles A2P 10DLC registration (incl. the sole-prop path above), supports automated texts, and has a public messages API. This ticket adds QUO as a **second, selectable send backend** so SMS can activate on QUO creds with no further code change, exactly like the Twilio path activates on Twilio creds today.

**This does NOT turn SMS on.** Sending still requires, per existing gating at every call site: `org.sms_enabled === true` **AND** `canUseRenterSms(org.plan)` (Growth+) **AND** a usable phone **AND** `!lead.sms_opt_out` **AND** provider creds present. For Agile specifically, keep it OFF until Noam gives the explicit go — flipping it is an operator-facing change and out of scope here.

---

## Scope — what to build

A provider abstraction inside `lib/sms.ts`. Keep every exported copy builder, the pure helpers, opt-out handling, and all four call sites (`app/r/[propertyId]/actions.ts`, `app/dashboard/tenancies/comms-actions.ts`, `app/dashboard/properties/[id]/waitlist-actions.ts`, `app/api/cron/reminders/route.ts`, `app/api/cron/appointment-reminder/route.ts`) **unchanged** — `sendSms({ to, body })` keeps its exact signature and `SmsResult` return shape.

### Files
1. **`lib/sms.ts`** — add the QUO backend + provider dispatch (details below).
2. **`scripts/test-sms.ts`** — extend with pure unit tests for the new pure helpers (no network).

No new routes, no migration, no dependency on the inbound webhook.

---

## Design (mirror the existing Twilio path)

### 1. Provider selection — explicit, default unchanged
Add a pure, tested helper:

```ts
export type SmsProvider = "twilio" | "quo" | "none";

/** Which backend sendSms will use, given current env. Pure; no I/O. */
export function selectSmsProvider(env = process.env): SmsProvider {
  const pref = (env.SMS_PROVIDER || "").trim().toLowerCase();
  const twilioReady = Boolean(
    env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN &&
      (env.TWILIO_MESSAGING_SERVICE_SID || env.TWILIO_FROM),
  );
  const quoReady = Boolean(env.QUO_API_KEY && (env.QUO_FROM || env.QUO_PHONE_NUMBER_ID));
  if (pref === "quo") return quoReady ? "quo" : "none";
  if (pref === "twilio") return twilioReady ? "twilio" : "none";
  // No explicit preference: prefer Twilio if ready (preserves today's behavior),
  // else QUO if ready, else none.
  if (twilioReady) return "twilio";
  if (quoReady) return "quo";
  return "none";
}
```

Update `isSmsConfigured()` to `return selectSmsProvider() !== "none";` (keeps its meaning; now covers QUO).

### 2. QUO payload builder — pure, tested
```ts
export type QuoPayload = { content: string; from: string; to: string[] };

/** Build the QUO/OpenPhone messages POST body, or null if the number is unusable. */
export function buildQuoPayload(to: string | null | undefined, body: string, from: string): QuoPayload | null {
  const e164 = normalizePhoneE164(to);
  if (!e164) return null;
  if (!body || !body.trim()) return null;
  return { content: body, from, to: [e164] };
}
```

### 3. QUO sender — I/O, never throws, returns `SmsResult`
Add `sendViaQuo({ to, body })` mirroring `sendSms`'s error discipline:
- Base URL from `QUO_API_BASE` (default the documented QUO/OpenPhone messages endpoint — **confirm against https://support.quo.com/core-concepts/integrations/api**; as of build, OpenPhone's is `https://api.openphone.com/v1/messages`). Making the base an env var means a domain change needs no redeploy.
- Auth header per QUO docs (OpenPhone uses the raw API key in `Authorization`, **not** `Bearer` — confirm and implement exactly as documented).
- `from` = `QUO_FROM` (E.164) — if the account addresses senders by phone-number ID, support `QUO_PHONE_NUMBER_ID` as the alternate `from`.
- `Content-Type: application/json`, body = `JSON.stringify(buildQuoPayload(...))`.
- `AbortSignal.timeout(8000)`.
- Non-2xx → `{ sent: false, reason: \`quo_${status}:${detail.slice(0,200)}\` }`.
- Success → `{ sent: true, sid: <message id from response> }`.
- Unconfigured / bad number / empty body → the same `no_credentials` / `invalid_number` / `no_body` reasons as Twilio (so callers' existing `reason !== "no_credentials"` alarm-suppression keeps working).

### 4. Dispatch in `sendSms`
At the top of `sendSms`, branch on `selectSmsProvider()`:
- `"twilio"` → existing Twilio body (unchanged).
- `"quo"` → `return sendViaQuo({ to, body })`.
- `"none"` → `return { sent: false, reason: "no_credentials" }` (unchanged behavior for an unconfigured deploy).

Keep the Twilio code path byte-for-byte where possible; only wrap it behind the branch.

---

## Provider extensibility (design note — build for N, not 2)

Noam wants to offer a **choice** of SMS providers (Twilio, QUO, and possibly Telnyx/Plivo later). Build the selector as a small **registry**, not a hardcoded two-way branch, so a third backend is one entry + its env vars — no change to `sendSms` or any call site:

```ts
type SmsBackend = {
  ready: (env: NodeJS.ProcessEnv) => boolean;
  send: (input: SendSmsInput) => Promise<SmsResult>;
};
const SMS_BACKENDS: Record<Exclude<SmsProvider, "none">, SmsBackend> = {
  twilio: { ready: twilioReady, send: sendViaTwilio },
  quo:    { ready: quoReady,    send: sendViaQuo },
  // future: plivo / telnyx / vonage / sns — add one entry + its *_READY + send fn
};
```

- `selectSmsProvider(env)` returns the `SMS_PROVIDER`-preferred backend if `ready`, else the first `ready` backend in a defined priority order (twilio → quo → …), else `"none"`.
- `sendSms` becomes: `const p = selectSmsProvider(); return p === "none" ? {sent:false, reason:"no_credentials"} : SMS_BACKENDS[p].send({to, body});`. Refactor the existing Twilio body into `sendViaTwilio` unchanged.
- Each backend = a pure payload builder (unit-tested, no I/O) + a thin `send`. This is the whole extensibility story; keep it this shape.

**Eligibility rule (enforce in review, not code):** a provider is only addable if it has a **programmatic send API** *and* supports **A2P / registered sending**. Consumer apps — **Fongo, Google Voice, TextNow** — are explicitly out: no send API, and automating them breaches carrier A2P rules + their consumer terms. Realistic future backends: **Telnyx, Plivo, Vonage, AWS SNS, Sinch**.

**Out of scope (future):** per-org provider choice (an `organizations.sms_provider` column so a Vacantless *customer* can pick/BYO) is a clean extension of this registry, but keep selection **env-driven** for now — don't add the column here.

---

## Env vars (set in Vercel — Noam, secrets)
- `SMS_PROVIDER` = `quo` (or leave unset once Twilio is fully gone; explicit `quo` is safest)
- `QUO_API_KEY`
- `QUO_FROM` (the QUO number in E.164, e.g. `+1519...`) **or** `QUO_PHONE_NUMBER_ID`
- `QUO_API_BASE` (optional override; default the documented endpoint)
- `QUO_STATUS_CALLBACK_URL` (optional)

Nothing activates until these land AND an org has `sms_enabled=true` on a Growth+ plan.

---

## Compliance / follow-ups (note, do not build here)
- **STOP handling:** carrier-level A2P STOP is honored by QUO/the carrier automatically, so opt-outs are enforced at the provider even without an app webhook. The Twilio inbound webhook (`app/api/sms/inbound`) that sets `leads.sms_opt_out` is Twilio-signature-specific; a QUO inbound-webhook parity path (to also record opt-outs in-app) is a **separate future ticket**, not required for go-live.
- **Sender identity:** use a dedicated Vacantless/Agile QUO number, not a number registered to another brand — A2P registration is brand-scoped.
- **Consent for A2P registration:** the registration asks how consent is collected. Renters give their number on the /r booking form to receive viewing details — that is the documented consent basis; keep the form's SMS-consent line accurate.

---

## Gates (this repo)
- `next build` (tsc) clean.
- `next lint` green (pre-existing job-page `<img>` advisory is known/allowed).
- `git diff --check` clean.
- Report unit-test counts.

## Tests (`scripts/test-sms.ts`, pure — no network)
- `selectSmsProvider`: twilio-only env → `twilio`; quo-only env → `quo`; both + `SMS_PROVIDER=quo` → `quo`; both + unset → `twilio`; neither → `none`; `SMS_PROVIDER=quo` but no QUO creds → `none`.
- `buildQuoPayload`: valid 10-digit → `{to:["+1…"]}`; already-E.164 kept; junk number → `null`; empty body → `null`.
- Regression: existing Twilio/`normalizePhoneE164`/`classifyInbound`/quiet-hours tests still pass unchanged.

## Verification (Cowork, after Codex builds)
- `device_bash git diff` review: change confined to `lib/sms.ts` (new helpers + dispatch branch + `isSmsConfigured` one-liner) + `scripts/test-sms.ts`. All four call sites and every copy builder untouched; Twilio path preserved.
- Post-deploy, **with SMS still OFF for Agile**: confirm nothing changed (an unconfigured/`SMS_PROVIDER` unset deploy still returns `no_credentials`; no org starts texting).
- Go-live test happens later, on Noam's go, via the waitlist-notify path to a controlled number (per `feedback_twilio_sms_not_configured`), once `QUO_*` env + a dedicated number are set.

## Standing rules
Codex builds; Cowork verifies the real diff via `device_bash git`; **Noam pushes**; migrations via Supabase MCP (n/a here). Do not auto-push. Never enable renter SMS for Agile without Noam's explicit go-ahead.
