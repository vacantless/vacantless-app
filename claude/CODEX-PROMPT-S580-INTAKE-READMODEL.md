# CODEX PROMPT — S580: Stage-2 intake read-model ("What the computer has read so far")

Implement this end to end in `vacantless-app`, following every standing constraint
below. **Do not `git push`** — land natively; Noam pushes.

## Why

Stage 2 of the presentation-layer command center (design of record:
`claude/DESIGN-PRESENTATION-LAYER-COMMAND-CENTER-S577.md`) shows the operator ONE
accessible "WHAT THE COMPUTER HAS READ SO FAR" panel with green-check fields after
they forward an email, drop a document, or type details in. The parsing plumbing
already exists; this slice adds the normalized read-model the panel renders, ahead
of the UI.

## Scope

1. First, verify the REAL parse-result shapes (KI926 — do not assume fields):
   - `lib/lease-extract-vision.ts` `parseLease(...) : Promise<LeaseParseResult>`
   - `lib/listing-extract-vision.ts` `parseListing(...) : Promise<ListingParseResult>`
   - `lib/mls-import.ts` `parseMlsListing(text) : ParsedListing`
   - `lib/asset-capture-vision.ts` `parseAssetImage(...)`
   Read each result type and note which fields exist and whether any
   confidence/exactness signal is already reported.

2. Add a pure normalizer `toIntakePreview(source)` that maps ANY of the above parse
   results into one accessible shape the Stage-2 panel renders:

   `type IntakeField = { label: string; value: string; found: boolean; confidence?: "exact" | "partial" }`
   `type IntakePreview = { fields: IntakeField[]; publicDescription: string | null; sourceKind: "email" | "document" | "mls" | "manual" }`

   - Only surface fields the parser actually returned (found:true). Never fabricate
     a green check for a field the parser did not extract (honesty rule — the whole
     panel is trust-building for older operators).
   - `confidence` is passed through ONLY if the underlying parser reports it; omit
     it otherwise rather than inventing a value.
   - `publicDescription` is the AI-polished blurb IF the existing pipeline already
     produces one; else null.

3. A tsx test (matching `scripts/test-distribution-channels.ts` style) with a
   fixture parse result for each source kind, asserting: extracted fields map to
   `found:true`; a missing field never appears as found; `confidence` is only
   present when the fixture provided it; `sourceKind` is set correctly. Keep it
   pure — pass fixtures in, do not call the real vision/LLM parsers.

## Standing constraints

- Land natively; **do not `git push`**.
- Purely additive, **no migration**, no change to any existing parse/intake flow.
  This is a normalizer + a type, safe to deploy dark.
- Reuse the REAL parse-result types (KI926). Do NOT introduce a new parser.
- tsc clean; run the tsx test natively.

## Definition of done

- `toIntakePreview` normalizes all four real parse-result shapes into `IntakePreview`
  without fabricating fields.
- Test passes natively; tsc clean. No migration, no existing-flow change.
- Report back the file list + the confirmed real field set of each parse-result
  type (so warm-verify can check nothing was invented).
