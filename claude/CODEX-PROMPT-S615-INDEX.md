# CODEX BUILD — S615 index / handoff (read THIS first)

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-02
This is the entry point for the S615 work. Three independent builds, all **ship dark**. B2 + taxonomy touch the V2 add-property surface and have **no migration**; the AI-KB adds **migration 0207** (Cowork applies it — Codex authors, does not apply). Do them in order, or in parallel if you isolate the files — they do not overlap.

## What we need from you (the three builds)
1. **Lane B2 — address autocomplete + geocoding.** Full spec: **`vacantless-app/claude/CODEX-PROMPT-ADD-PROPERTY-GEOCODE-LANE-B2-S615.md`**. Adds `lib/geocode.ts` (provider seam, Radar default, no-op Null provider with no key), two server actions, an Address combobox in the V2 form, and persists `latitude`/`longitude` in `createPropertyV2`. Commit: `feat: address autocomplete + geocoding via provider seam (lane B2)`.
2. **Taxonomy pass — property type → `unit_type`.** Full spec: **`vacantless-app/claude/CODEX-PROMPT-LISTING-EXTRACT-TAXONOMY-S615.md`**. Adds `propertyType` to the parse contract + a `mapUnitTypeFromRaw` mapper so a pasted "Condo Apartment" fills Unit type. Commit: `feat: map listing property type to unit_type on import (taxonomy pass)`. **The pets half of that prompt is explicitly GATED — do NOT build it** (it reverses a documented policy); build only the "SHIP THIS" section.

3. **AI leasing knowledge base.** Full spec: **`vacantless-app/claude/CODEX-PROMPT-AI-LEASING-KB-S615.md`**. Adds `property_qa` (**mig 0207**) + `lib/property-qa.ts` (store + deterministic match) + a `knowledge` seam in `lib/ai-reply.ts` + a curation UI + a learn-time LLM capture hook on the reply panel. All behind the existing `ai_reply` gate (**verified dark in prod: `AI_REPLY_ENABLED` is unset in Vercel**). Commit: `feat: AI leasing knowledge base — per-property Q&A store, curated org pool, learn-time capture (dark)`. **Codex authors 0207 but does NOT apply it.**

Each build prompt is self-contained (its own scope, tests, DONE criteria). This index just aggregates the read-list and the standing rules so nothing is missed.

## What you need (read-first, before touching anything)
**Shared / add-property write path:**
- `app/dashboard/properties/actions.ts` — `createPropertyV2`@647 (insert hardcodes `latitude:null, longitude:null`@~720 — B2 replaces that line) and `prefillAddPropertyV2`@531 (the server-action-from-client pattern both builds mirror).
- `app/dashboard/properties/new/add-property-form.tsx` — the Address `<input name="address">`@~482 in the "Core" section; the `useTransition`/`applyPrefill` client pattern.
- `lib/env.ts` (or wherever `envFlagEnabled` lives) — env-flag reading style; `ADD_PROPERTY_V2_ENABLED` gate.

**Lane B2 also needs:**
- Any existing outbound-HTTP lib for `fetch` + timeout + error-handling house style (e.g. the QUO/SMS lib `lib/sms.ts`, or the vision-import lib).
- Note: `latitude`/`longitude` `double precision` columns already exist (mig 0206) and are already SELECTed by `get_org_listing_feed`/`get_network_listing_feed` — **no migration.**

**Taxonomy also needs:**
- `lib/mls-import.ts` — `ParsedListing`, `emptyParsedListing`, the label STOP-SET (~L127, already lists "property type"/"building type"/"type"), and `parseMlsListing`'s label→value extraction.
- `lib/property-features.ts` — `UNIT_TYPE_OPTIONS` (apartment | condo | basement-apartment | house | townhouse | duplex-triplex), `STRUCTURE_TYPE_OPTIONS`, `normalizeUnitType`/`normalizeStructureType`.
- `lib/add-property-v2.ts` — `addPropertyV2DraftFromListing` (never sets `unit_type` today — that's the fix site).
- `lib/listing-extract.ts` — `ListingDraft`, the extraction JSON schema/prompt, `applyAiListing` (deterministic-wins merge). **Note its header policy: pets are deliberately NOT inferred — respect that; the gated pets section stays unbuilt.**

**AI-KB also needs:**
- `lib/ai-reply.ts` — `buildAiReplyDraft` (deterministic template; add the `knowledge` seam here) and `AiReplyDraftInput`.
- `app/dashboard/leads/[id]/page.tsx` — `canUseAiReply`@212, `buildAiReplyDraft` call@220, `<InquiryReplyPanel>`@~607; `l.property`/`l.notes` in scope (load knowledge + pass leadId/propertyId/inquiryText down).
- `app/dashboard/leads/inquiry-reply-panel.tsx` — client panel with editable `text`, "Open in email" `mailto:`, "Copy message" (the auto-learn capture hook points; **no server send exists**).
- `lib/feature-entitlements.ts` — the `ai_reply` gate (`isFeatureEnabledForOrg`); do not change it.
- An **existing org-scoped table's migration** for RLS + `service_role` GRANT style (mirror it — the S539 reminders incident was a missing service_role SELECT grant; don't repeat it).
- The existing vision/LLM lib for `fetch`/prompt house style (the learn-time `extractQaPair` call mirrors `lib/listing-extract`'s pure/impure split).

**Test style references:** `scripts/test-add-property-v2.ts`, `scripts/test-mls-import.ts`, and however the repo's runner registers `scripts/test-*.ts` (mirror it for the new `scripts/test-geocode.ts` / `scripts/test-property-qa.ts` and the added cases).

## Standing rules (both builds)
- **Warm-verify first** (read the files above for the build you're on) before writing code. Reuse existing normalizers/helpers; match house style; no new npm dependency (use global `fetch`).
- **Build + verify + commit by name. Do NOT push. Do NOT apply any migration** — B2 + taxonomy have none; the AI-KB authors `0207` but **Cowork applies it** (mig-before-deploy).
- Gates, both builds: `npx tsc --noEmit`, `npm run lint` (known job-page `<img>` advisory allowed), `npm run build`, `git diff --check` all clean; all pure tests green.
- **Dark/degradation invariants:** with `ADD_PROPERTY_V2_ENABLED` off, `/dashboard/properties/new` behaves as today. With **no `RADAR_API_KEY`**, the Address field and `createPropertyV2` behave byte-for-byte as today (null coords). The taxonomy mapper only fills `unit_type` when confident; unknown → leave blank (never guess).
- **Reply with, per build:** branch, SHA, diffstat, test counts.

## Out of scope this session (do not build)
- **Pets inference** (gated in the taxonomy prompt — awaiting Noam).
- **A grounded-LLM AI *draft* (Option B)** — the AI-KB build adds only the read *seam* for it, no draft-time model call.
- Auto-classifying a learned answer as org-wide (AI-KB auto-learn is per-property only; org-wide is curated).
- Existing-property address editing / live map preview / reverse geocoding / a 2nd live geocode provider (Google & Mapbox are seam stubs only).

## After you finish (the loop)
Cowork warm-verifies each diff vs prod (scope confined to the files above; re-runs pure tests; confirms the dark + no-key paths), and **applies migration 0207 + readback** for the AI-KB before deploy (the others have no migration). Then Noam does the file-scoped push, sets `RADAR_API_KEY` in Vercel for B2 + (later, his call) `AI_REPLY_ENABLED` + the LLM key for the AI-KB — Noam types every value (KI988) — redeploys, and dogfoods on a QA org.
