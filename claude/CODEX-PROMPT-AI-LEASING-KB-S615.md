# CODEX BUILD — S615: AI leasing knowledge base (per-property Q&A + curated org pool + auto-learn)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
**Type:** upgrade the existing (template) AI reply so it can answer property-specific questions from a learned Q&A store. Design context: `claude/DESIGN-AI-LEASING-KB-S615.md`.
**Migration:** **0207** — new `property_qa` table (next free number; 0206 is the last applied).
**Flag:** none new — everything lives behind the **existing `ai_reply` entitlement** (env master `AI_REPLY_ENABLED`). **Verified 2026-08-02: `AI_REPLY_ENABLED` is NOT set in Vercel → the feature is DARK in prod today.** So this ships dark automatically; it only activates when Noam later sets that env master.
**Risk:** low-medium (new table + read/write on the lead reply surface). All gated by `ai_reply`, which is off in prod.

> **EGRESS DECISION — Noam, 2026-08-03: DETERMINISTIC ONLY. Do NOT wire the learn-time LLM call.** The auto-learn extraction would send renter inquiry text + the operator's edited reply to Anthropic's API — tenant communications, a data-egress decision Noam is deferring pending a privacy-policy review. **This build is Phase 1 only (zero external egress).** Keep the `source` column + the `knowledge` read seam so auto-learn can be added later, but build NO capture hook, NO `captureLeadReplyKnowledge` action, NO `extractQaPair`, and make NO outbound `fetch`/LLM call anywhere in this change.

## Warm-verified facts (checked on disk 2026-08-02 — build to these, don't re-assume)
- `lib/ai-reply.ts` `buildAiReplyDraft` is a **deterministic template** (structured fields + one regex "inquiry cue" + slot offer). No LLM, no knowledge. This is the read site to extend.
- Gate chain (`lib/feature-entitlements.ts` → `isFeatureEnabledForOrg("ai_reply", …)`): env master `AI_REPLY_ENABLED` truthy → then per-org `feature_flags` override → else plan default. `planDefaultForFeature("ai_reply")` = **true for all plans**. So the env master is the real switch and it's currently unset (dark).
- The AI draft is consumed in **`app/dashboard/leads/inquiry-reply-panel.tsx`** (client component): editable `text` state, an **"Open in email" `mailto:` link**, a **"Copy message"** button, and an **"AI draft"** button. **There is NO server-side reply send** — the operator sends from their own mail client. Auto-learn therefore hooks the send/copy *click*, not a server send action.
- The panel is fed from `app/dashboard/leads/[id]/page.tsx` (@~607: `<InquiryReplyPanel subject body aiDraft />`); `canUseAiReply`@212 already gates the AI path there; `l.property` + `l.notes` (renter's inquiry) are in scope on that page.

## Accepted design decisions (Noam, 2026-08-02) — build exactly this
1. **Option A first, with a seam for a future LLM draft (B).** Deliver the knowledge store + deterministic read now; keep `buildAiReplyDraft` reading a `knowledge` array so a later grounded-LLM draft consumes the *same* store.
2. **Per-property store + operator-curated org-wide pool.** Same read step checks property-scoped answers first, then org-wide common answers. **Auto-learn writes PER-PROPERTY only** (can't mis-scope a unit-specific fact org-wide). The org-wide pool is operator-curated (add in a curation UI + "promote to all listings").
3. **Learn-time LLM assist — DEFERRED (do NOT build in this change).** The design keeps a learn-time extraction path, but wiring it is deferred pending Noam's egress decision (see the EGRESS DECISION note above). This build ships the deterministic store + read + curation only. The `property_qa.source` enum already includes `'auto'` so a future auto-learn write fits without a schema change.

## Standing rules
- **Warm-verify first** (read the files named above + an existing table's migration for RLS/GRANT style — see the grant-gap lesson below). Reuse helpers; match house style; no new npm dep. **No outbound `fetch` / LLM call in this change** (deterministic only).
- Codex **builds + verifies + commits by name. Do NOT push. Do NOT apply the migration** — Cowork applies 0207 + readback before Noam deploys (mig-before-deploy).
- Gates: `npx tsc --noEmit`, `npm run lint` (known job-page `<img>` advisory allowed), `npm run build`, `git diff --check` clean; all pure tests green. Report branch, SHA, diffstat, test counts.

---

## Scope

### Phase 1 — store + read + curation (deterministic, NO key, this is the core)

**1. Migration `supabase/migrations/0207_property_qa.sql`**
- Table `public.property_qa`: `id uuid pk default gen_random_uuid()`, `organization_id uuid not null references organizations(id) on delete cascade`, `property_id uuid references properties(id) on delete cascade` (**NULL = org-wide common answer**), `question_key text not null` (normalized match key), `question_text text not null` (display), `answer_text text not null`, `source text not null default 'operator' check (source in ('operator','auto'))`, `created_at`/`updated_at timestamptz not null default now()`.
- Unique per scope+key: `unique index on (organization_id, coalesce(property_id, '00000000-0000-0000-0000-000000000000'::uuid), question_key)` (lets auto-learn upsert-on-conflict).
- Lookup index on `(organization_id, property_id)`.
- **RLS + GRANTS: mirror an existing org-scoped table EXACTLY** (org-member policies + the `service_role` grants). ⚠️ The reminders incident (S539) was a missing `service_role` SELECT grant — do not repeat it; grant SELECT/INSERT/UPDATE/DELETE to the roles the sibling tables grant.

**2. Data access — `lib/property-qa.ts` (new)**
- `loadPropertyKnowledge(supabase, orgId, propertyId): Promise<PropertyQaEntry[]>` — returns property-scoped rows + org-wide (property_id null) rows for the org, property-scoped sorted first.
- Pure `normalizeQuestionKey(text): string` — lowercase, strip punctuation, drop stopwords, stable token key. Used for BOTH storage and matching.
- Pure `matchKnowledge(inquiryText, entries): PropertyQaEntry | null` — best match by normalized-key/keyword overlap; **property-scoped beats org-wide**; no confident match → null.
- Pure upsert-arg builder `buildQaUpsert({...})` (org/property/question/answer/source) applying `normalizeQuestionKey`.

**3. Read path — extend `lib/ai-reply.ts`**
- Add optional `knowledge?: PropertyQaEntry[]` to `AiReplyDraftInput`. In the draft build, before the generic `inquiryCue` fallback, call `matchKnowledge(inquiryText, knowledge)`; on a hit, **replace** the generic "I can confirm that before we book" line with the stored `answer_text` (woven in as a sentence). No match → today's exact behavior. Keep it pure/deterministic.
- Wire in `app/dashboard/leads/[id]/page.tsx`: when `canUseAiReply`, `loadPropertyKnowledge(...)` for `l.property?.id` + org, pass as `knowledge` to `buildAiReplyDraft`.

**4. Curation UI (operator-curated org-wide pool + per-property edits)**
- A minimal "Answers the AI can use" panel — place it on the **property detail** page (a new collapsed section) and/or the lead reply area; keep it small. List the property's Q&A + the org-wide common answers; add / edit / delete; a **"Promote to all my listings"** action that re-writes a per-property row as an org-wide (property_id null) row. Server actions in `lib/property-qa` or `app/dashboard/properties/[id]/actions` — org-scoped, capability-checked, gated by `ai_reply`.

### Phase 2 — auto-learn — DEFERRED, DO NOT BUILD
Pending Noam's egress decision. Build **none** of it in this change: no capture hook in `inquiry-reply-panel.tsx`, no `captureLeadReplyKnowledge` server action, no `lib/property-qa-extract.ts`, no `extractQaPair`, no outbound model call. Do NOT add `leadId`/`propertyId`/`inquiryText`/`canLearn` props to `inquiry-reply-panel.tsx` (leave that client component untouched). The store's `source='auto'` value and the `knowledge` read seam already leave room to add this later without a schema change.

### Tests (pure, no network) — `scripts/test-property-qa.ts`
- `normalizeQuestionKey`: casing/punctuation/stopword stability; two phrasings of the same question → same key.
- `matchKnowledge`: property-scoped beats org-wide; keyword overlap hit; no-match → null.
- `buildAiReplyDraft` with a `knowledge` hit injects the stored answer; with no knowledge → byte-identical to today's template output (guard the seam).
- Register in the repo's test runner (mirror `scripts/test-add-property-v2.ts`). Keep all existing tests green. (Table RLS/grants are validated by Cowork via SQL, not unit tests.)

## Out of scope (do not build)
- **The learn-time LLM auto-extraction / any outbound model call (egress DEFERRED — see the note up top).**
- A grounded-LLM *draft* (Option B) — only the read-seam for it. No draft-time model call.
- Any change to `inquiry-reply-panel.tsx` or the `ai_reply` gate itself or to non-AI reply behavior.

## DONE criteria
Gates clean; pure tests green with counts. **No outbound `fetch`/LLM call anywhere in the diff.** With `AI_REPLY_ENABLED` unset (today), the lead page + reply panel behave exactly as now (no knowledge loaded, template unchanged). Migration authored but NOT applied. Commit: `feat: AI leasing knowledge base — per-property Q&A store + curated org pool + deterministic read (dark)`. Reply branch/SHA/diffstat/test counts. Do NOT push.

## Cowork warm-verify + go-live (after Codex)
1. Diff scope = 0207 migration + `lib/property-qa.ts` + `lib/ai-reply.ts` seam + lead page wiring + curation UI + tests. NO reply-panel change, NO capture action, NO LLM lib. Grep the diff for `fetch(`/`anthropic`/`extractQaPair` → must be absent.
2. Apply 0207 in the cloud + readback (table, indexes, RLS, **service_role grants** present). Re-run pure tests.
3. Confirm dark: `ai_reply` off → no knowledge load, template output unchanged.
4. Go-live later (Noam's call, separate): set `AI_REPLY_ENABLED` in Vercel — Noam types the value (KI988) — then dogfood on a QA org: seed a property answer via curation → renter-style inquiry → AI draft injects it; org-wide promote works. Reset QA rows. (Auto-learn stays a separate future decision.)
