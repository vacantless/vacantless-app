# Lease-OCR Extraction Spec (PII-safe)

Date: 2026-07-06 (S425)
Status: SPEC for review, no code yet
Author: Noam / Vacantless

## 1. Goal

Turn an uploaded signed lease (PDF or image) into a pre-filled DRAFT tenancy that the operator reviews and confirms in one screen, instead of hand-keying eight-plus fields. This is the missing front door to the money and compliance layer: every tenancy, rent amount, term date, deposit, and downstream N1 / rent-increase / reminder currently starts as manual data entry. A lease upload replaces that with an upload plus a confirm.

Non-goal for Phase 1: storing or interpreting any sensitive tenant identifier. See section 4. This is why the item has always carried the "(PII pass)" tag; the PII boundary is the first thing to get right, before any code.

## 2. Reuse the existing capture pattern (do not invent a new one)

The repo already ships this exact shape for the Unit-Bible photo-OCR (S364). Lease-OCR mirrors it aimed at the tenancy skeleton:

- `lib/asset-capture.ts` = the PURE contract (JSON schema the model must return, the prompt, the normalizer, the bounds clamps). No DB / env / I/O, unit-tested via a `scripts/test-*.ts` runner.
- `lib/asset-capture-vision.ts` = the IMPURE half (the Anthropic Messages call, `ANTHROPIC_API_KEY` + `ASSET_CAPTURE_MODEL`, 25s timeout, never-throws typed `{ok:false, reason}` union, ships DARK with no key set so the UI falls back to the manual form).

New modules, same split:

- `lib/lease-extract.ts` (pure): the `LeaseDraft` schema, the extraction prompt, the normalizer, the PII redaction guard, the field clamps that mirror `validateTenancyInput` / `parseMoneyToCents` / `parseTermMonths` in `lib/tenancy.ts` so a scanned draft can never carry a value the manual tenancy form would reject.
- `lib/lease-extract-vision.ts` (impure): the model call. Gated dark on `ANTHROPIC_API_KEY`; overridable model id via a `LEASE_EXTRACT_MODEL` env (default a Haiku-tier vision model, same as asset-capture; a lease is a longer document read, so `max_tokens` is higher, see section 6).

Dependency note: `pdfjs-dist` is already installed. See section 6 for PDF handling (native Anthropic document block vs pdfjs rasterize).

## 3. What we EXTRACT (the tenancy skeleton)

The target is exactly the fields the manual new-tenancy form already accepts (`app/dashboard/tenancies/new/page.tsx`), plus a short clause digest. The `LeaseDraft` the model returns:

Tenancy core:
- `start_date` (lease start; ISO, via `parseDateOrNull`)
- `end_date` (fixed-term end, or null for month-to-month)
- `term_months` (integer; derivable if start+end present)
- `rent_cents` (monthly rent; via `parseMoneyToCents`)
- `deposit_cents` (the deposit amount; via `parseMoneyToCents`)
- `deposit_type` enum: `lmr` | `security` (Noam, S425: in Ontario the deposit is Last Month's Rent ~99% of the time, but a landlord may take a rent-equal deposit as one OR the other, never both, and the two are handled slightly differently downstream). Default `lmr`; the model classifies from the lease wording; operator confirms on the review screen.
- `lease_type` enum: `fixed` | `month_to_month`

Parties (contact identity only, needed to create the tenancy + tenants):
- `tenants[]`: `{ name, email | null, phone | null }` (1 to `MAX_TENANTS_PER_TENANCY`; first is primary)
- `landlord_name` (display only, for the confirm screen; not persisted as a new entity)

Property match (NOT free-text stored):
- `unit_address` = a text hint the model reads off the lease. We do NOT store this as an address. We use it only to SUGGEST which of the org's existing rentals this lease belongs to (fuzzy match against the org's properties). The operator picks the unit from the same dropdown the manual form uses. If no confident match, the dropdown opens unselected.

Clause digest (Noam, S425: PRE-FILL the real structured flags, operator must double-check before save; not just advisory text). Each of these is read off the lease, pre-filled on the review screen as an actual editable field/toggle, and only written when the operator saves:
- `pets_allowed` (bool | null), `smoking_allowed` (bool | null)
- `utilities_tenant_pays` (short text, e.g. "hydro"), matches the standing Agile disclosure pattern (hydro-extra + unfurnished)
- `parking` (short text | null)
- `rent_due_day` (1 to 31 | null)
- `late_fee` (short text | null)
- `notes` (a <= 500-char plain-language summary of any other material clause)

Flip-switches-with-review posture: because a misread clause could otherwise drive a wrong automated action, every pre-filled flag renders with a subtle "from the lease, please confirm" marker, and NONE of them are written until the operator submits the form. So the AI proposes the switch position; the operator ratifies it. Any of these flags that the current tenancy/property schema does not yet have a column for is added as part of this build (small additive migration), gated so the field simply does not render if absent.

Every free-text field is trimmed to a `MAX_TEXT_LEN` ceiling (mirror asset-capture's 120-char clamp; `notes` gets its own 500 cap). Every field is nullable; an empty draft (all null) returns `{ok:false, reason:"empty"}` and the UI falls back to the manual form, same as asset-capture.

## 4. What we HARD-REFUSE to persist (the PII boundary)

This is the core of the spec. A signed lease commonly carries exactly the identifiers we are forbidden to store. Three layers of defense, so a single failure never persists PII:

Layer 1 (prompt): the extraction system prompt explicitly instructs the model to NEVER return, and to actively ignore, any of the following even when present on the lease:
- Social Insurance Number / SSN
- Driver's licence number
- Bank account / transit / institution numbers, void-cheque / PAD details
- Credit-card numbers
- Date of birth
- Passport / government ID numbers
- Guarantor financial identifiers, emergency-contact medical details

Layer 2 (normalizer, defense-in-depth): `lib/lease-extract.ts` runs a redaction guard over EVERY returned string field. Any value matching a SIN/SSN pattern, a bank-account/transit pattern, a 13-to-19-digit card pattern, a licence-number pattern, or a DOB pattern is stripped to null before the draft is ever handed to the UI or DB. This runs regardless of what the model returned, so a prompt regression cannot leak an identifier into a stored field. The guard is pure and unit-tested with positive and negative fixtures.

Layer 3 (document bytes): Phase 1 does NOT persist the raw lease file. The bytes are sent to the model transiently and discarded after parsing, identical to asset-capture's posture ("the image is sent to the parse call transiently and NOT stored; no tenant PII"). Storing the lease PDF as a tenancy document is a SEPARATE, existing, opt-in path (`lib/documents.ts` + `document-retention.ts`); if the operator later chooses to attach the lease, it flows through that retention-governed feature, not this extraction path. Phase 1 keeps extraction and storage decoupled on purpose.

This matches the standing rule from memory: NEVER persist tenant DL / credit / SIN / bank PII. The owner's OWN bank data (bank-feed) is a different, intended feature; a tenant's identifiers on a lease are not.

## 5. Review-first flow (the operator confirms; nothing auto-writes)

1. Operator opens New Tenancy (or a lead's Ready-to-lease), sees an "Upload the signed lease to pre-fill" option above the manual form.
2. They upload a PDF or image. The server action calls `parseLease(bytes, mime)`.
3. On `{ok:true}`: the same tenancy form renders PRE-FILLED with the draft: unit dropdown pre-selected to the matched rental (or open if unmatched), dates / rent / deposit / term filled, tenant rows filled, and a collapsed "What the lease says" panel showing the clause digest. Every field stays editable. A small banner reads "Pre-filled from the lease. Review each field before saving."
4. On `{ok:false}` (unconfigured / failed / empty): the plain manual form renders with a quiet note, no error. Dark-safe: with no `ANTHROPIC_API_KEY`, the upload option can be hidden entirely so the feature ships inert until Noam sets the key in Vercel (Sensitive), exactly like asset-capture.
5. The operator saves through the UNCHANGED `createTenancy` action + `validateTenancyInput`. No new write path, no new money surface. The extraction only pre-fills a form the operator submits.

Design rule honored: minimal clicks (Tesla rule). Upload plus review plus save, versus eight-plus manual fields.

## 6. Model call details

- Input format: prefer the Anthropic Messages API native `document` content block for PDFs (`type:"document"`, `source:{type:"base64", media_type:"application/pdf"}`), which reads text-layer PDFs directly without rasterizing. For image uploads (photo of a lease page) reuse the `image` block path already in asset-capture. `pdfjs-dist` stays available as a fallback to rasterize a scanned image-only PDF to page images if the document block underperforms on a specific lease; decide during the live QA pass.
- `max_tokens`: higher than asset-capture's 512 (a lease draft plus clause digest is bigger); start at ~1500, tune in QA.
- Multi-page: send the FIRST 8 PAGES (Noam, S425: the material terms plus the additional-terms SCHEDULE where pets/parking/utility clauses live are all inside the first 8 of an Ontario standard lease; beyond that is signatures/boilerplate). Bounds cost and latency while catching the schedule. Tunable in QA.
- Reliability: same never-throws contract, 25s timeout, `{ok:false, reason}` union, ASCII-key guard (KI555), unsupported-media guard.
- Sandbox constraint (per standing rule): the live model call cannot be exercised from the build sandbox. The request shape is fixed to the documented Anthropic API and live-proves on the first deploy, QA on North Star (`b733a191`) with a synthetic/sample lease, never a real tenant's lease during testing.

## 7. Testing

- Pure unit tests (`scripts/test-lease-extract.ts`): the normalizer clamps, the PII redaction guard (SIN / bank / card / licence / DOB positive fixtures all strip to null; benign fixtures pass through), empty-draft detection, term derivation, money parsing edge cases. tsc is the gate.
- Live QA on North Star with a SYNTHETIC lease PDF (fabricated names + a fake SIN / fake void cheque embedded) to prove Layer 2 strips them end to end and nothing sensitive reaches the DB. Verify each write with a follow-up read (Supabase connector write-path can be flaky). Then wipe QA to baseline.
- Never run the live extraction against a real tenant's lease during development.

## 8. Slice plan

- Slice 1 (this build): `lib/lease-extract.ts` pure contract + PII guard + tests; `lib/lease-extract-vision.ts` gated dark; the upload-and-prefill wiring on the New Tenancy form; QA on North Star with a synthetic lease. Ships DARK (no key) so it is inert until Noam flips `ANTHROPIC_API_KEY` + `LEASE_EXTRACT_MODEL` in Vercel.
- Slice 2 (later): optional opt-in "attach this lease to the tenancy" that routes the PDF through the existing `documents` + `document-retention` path (governed storage, operator choice). Kept separate from extraction on purpose.
- Slice 3 (later): feed the extracted term dates + rent into the parked Stripe rate-change slice and the N1 generator, which today depend on hand-entered data.

## 9. Decisions (resolved S425)

1. Page cap: FIRST 8 PAGES (catches the additional-terms schedule). RESOLVED.
2. Clause digest: PRE-FILL real structured flags, operator confirms before save (not advisory-only). RESOLVED. Adds a small additive migration for any flag column that does not yet exist.
3. Deposit: default LMR (~99%), but carry a `deposit_type` (`lmr` | `security`) since Ontario permits one or the other (never both) and they are handled slightly differently. RESOLVED.
