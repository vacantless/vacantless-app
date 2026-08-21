# CODEX BUILD — S616: AI-KB zero-egress auto-capture ("Save an answer for next time")

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** small UI + action enhancement on the LIVE AI leasing KB. Lets an operator turn the reply they just drafted into a reusable per-property Q&A answer, in one reviewed step. Grows the KB automatically **with ZERO egress** (no LLM, no network, no new vendor).
**Migration:** NONE (the `property_qa.source` column + the "Learned" badge already exist from S615 mig 0207).
**Flag:** NONE new — rides the existing `ai_reply` gate (feature is LIVE as of S616: `AI_REPLY_ENABLED=true`). Capture UI shows only when `ai_reply` resolves on for the org **and** the inquiry is attached to a rental.
**Risk:** low. Deterministic; additive; the write path already exists (`addLeadPropertyQa` → `savePropertyQaEntry`).

## Context (LIVE state — do NOT re-verify)
- AI-KB Phase 1 is LIVE (`AI_REPLY_ENABLED=true`, prod SHA 0d1e056). `buildAiReplyDraft` (`lib/ai-reply.ts`) injects a stored `property_qa` answer when `matchKnowledge` hits, else a template cue. Curation UI = `app/dashboard/leads/property-qa-panel.tsx` (server component, form-action based), writing via `addLeadPropertyQa` in `app/dashboard/leads/actions.ts`.
- **Deliberately DEFERRED — do NOT build:** any LLM extraction / grounded-draft path (renter inquiry + operator reply → Anthropic). That is tenant-comms egress pending Noam's PIPEDA review. This ticket is the DETERMINISTIC, zero-egress capture ONLY.

## Warm-verify FIRST (rule 42 — read the live repo on disk, do not assume)
- `lib/ai-reply.ts`: `AiReplyDraft` type, `buildAiReplyDraft`, the `inquiryCue(inquiryText)` keyword families (pet / parking / laundry / utilities / application / viewing-timing), `matchKnowledge` usage (line ~149).
- `lib/property-qa.ts`: `savePropertyQaEntry`, `buildQaUpsert` (already accepts `source: "operator" | "auto"`), `normalizeQuestionKey`.
- `app/dashboard/leads/actions.ts`: `addLeadPropertyQa` (currently hard-codes `source: "operator"`), `requireQaCurationContext` (enforces `requireCapability("manage_properties")` + `ai_reply` enabled + property-in-org — the write is already fully gated).
- `app/dashboard/leads/inquiry-reply-panel.tsx`: the client composer holding the live reply `text` state + the "AI draft" button.
- `app/dashboard/leads/[id]/page.tsx`: where `InquiryReplyPanel` is rendered (~line 620) and where `canUseAiReply`, `aiReplyDraft`, `l.property?.id` are already computed.
- Test style: `scripts/test-property-qa.ts`, `scripts/test-*` for ai-reply.

## Standing rules
Deterministic only; keep the "never invent / zero egress" posture. Match house style. Codex builds + verifies + commits by name; **do NOT push**; **no migration**. Gates: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `git diff --check`, pure tests green (report counts).

## HARD CONSTRAINTS (zero-egress guardrails — a diff that violates any is rejected)
1. **NO network / NO LLM / NO fetch / no `anthropic` / no outbound call.** A repo grep for `fetch(`, `anthropic`, `http` in the changed files must be EMPTY. Pure functions + existing Supabase server action only.
2. **NO migration, NO schema change.** Reuse the existing `property_qa.source` column.
3. **NO auto-persist / NO silent capture.** A row is written ONLY when the operator submits the reviewed capture form (explicit click). Nothing is captured on draft-generate, on send, or on page load. The save IS the confirm — this is the "confirm before reuse" guarantee.
4. **Dark-safe & gated.** Capture UI renders only when `canUseAiReply` is true AND the inquiry has a `property_id`. When `ai_reply` is off for an org, the composer must render exactly as today (no new UI). The action keeps its existing `requireQaCurationContext` gate regardless of any client hint.

## Scope — SHIP THIS

### 1. `lib/ai-reply.ts` — expose a suggested capture question
- Add `suggestedQuestion: string | null` to the `AiReplyDraft` type.
- Add a pure `suggestedCaptureQuestion(inquiryText: string | null | undefined): string | null` that mirrors the SAME keyword families `inquiryCue` already recognizes, mapping a detected **factual** cue to a canonical reusable question:
  - parking → `"Is parking available?"`
  - laundry → `"Is laundry available?"`
  - pet(s) → `"What is the pet policy?"`
  - utilities / utility / heat / hydro / water → `"Which utilities are included?"`
  - application / apply → `"How do I apply?"`
  - viewing / showing / timing-only asks → `null` (a scheduling ask is not a reusable property fact — do NOT offer capture)
  - nothing recognized → `null`
- In `buildAiReplyDraft`, set `suggestedQuestion`:
  - if `knowledgeMatch` is non-null → `null` (already answered from the KB; nothing new to capture),
  - else → `suggestedCaptureQuestion(input.inquiryText)`.
- Do not change the existing draft body/subject/cue behavior.

### 2. `app/dashboard/leads/actions.ts` — let the write path record `source="auto"`
- In `addLeadPropertyQa`, read an optional `source` form field: `const source = formString(formData, "source") === "auto" ? "auto" : "operator";` and pass it to `savePropertyQaEntry({ …, source })`.
- No other behavior change. The panel's existing form (which sends no `source`) keeps writing `"operator"`. Keep all gating (`requireQaCurationContext`) intact.

### 3. `app/dashboard/leads/inquiry-reply-panel.tsx` — the "Save an answer for next time" capture form
- New props: `leadId: string`, `propertyId: string | null`, `suggestedQuestion?: string | null`, `canCapture: boolean`.
- When `canCapture && propertyId`, render — below the existing action buttons — a `<details>` block titled **"Save an answer for next time"** containing a `<form action={addLeadPropertyQa}>`:
  - hidden inputs: `lead_id={leadId}`, `property_id={propertyId}`, `scope="property"`, `source="auto"`.
  - **Question**: text input, `defaultValue={suggestedQuestion ?? ""}`, placeholder `"e.g. Is parking available?"`.
  - **Answer**: a controlled textarea bound to a new `captureAnswer` state, plus a small button **"Use my reply"** that does `setCaptureAnswer(text)` (pulls the operator's current, live-edited reply into the answer so they can trim it to the reusable part). Placeholder: `"Write the exact answer the draft can reuse next time."`
  - a **"Save answer"** submit button.
  - one line of helper text: `"Saved as a reusable answer for this rental. You can edit or delete it in “Answers the AI can use” above."`
- The capture form uses the existing server action, so on submit it redirects to the `?qa=saved#property-qa` anchor exactly like the panel form (consistent UX). Importing the server action into this client component and using it as a form `action` is the standard Next pattern (the actions file is a server module).
- Match the composer's existing tailwind/house style; keep the capture block visually secondary (collapsed `<details>`, not a loud CTA).

### 4. `app/dashboard/leads/[id]/page.tsx` — wire the props
- Pass to `InquiryReplyPanel`: `leadId={l.id}`, `propertyId={l.property?.id ?? null}`, `canCapture={canUseAiReply}`, `suggestedQuestion={aiReplyDraft?.suggestedQuestion ?? null}`. (`canUseAiReply` and `aiReplyDraft` already exist in scope.)

### 5. Tests — pure
- `suggestedCaptureQuestion`: each factual family maps to its canonical question; a viewing/timing-only inquiry → `null`; empty/greeting/unknown → `null`.
- `buildAiReplyDraft`: `suggestedQuestion === null` when a `knowledge` match exists; equals the canonical question when the cue fires and there is NO match; unchanged `body`/`subject` otherwise.
- Keep all existing tests green.

## Cowork warm-verify (after Codex, before Noam pushes)
- Diff confined to the 4 files + tests. Grep the changed files for `fetch(` / `anthropic` / `http` → EMPTY (zero-egress proof). Re-run pure tests (report counts).
- Dogfood on North Star QA: open an inquiry with an unanswered factual question (no KB match), open "Save an answer for next time", pull in the reply, trim, Save → SQL readback: new `property_qa` row `source='auto'`, property-scoped; the panel shows the **"Learned"** badge; re-generate the AI draft on a next matching inquiry → the saved answer injects. (Delete the QA capture rows after, or keep as a fixture — Noam's call.)

Commit: `feat: zero-egress AI-KB capture — save a reply as a reusable answer (source=auto)`. Reply branch/SHA/diffstat/test counts. **Do NOT push.** No migration.
