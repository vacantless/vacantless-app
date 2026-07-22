TASK: REVIEW ONLY — do NOT write code or a migration. Give an independent read on the property
"add → set up → publish → distribute" flow, then critique the attached scoping doc. Output a
written review (findings + a recommendation), not a diff.

════════════════════════════════════════════════════════════════════════
READ FIRST
════════════════════════════════════════════════════════════════════════
Scoping doc to critique: claude/DESIGN-PROPERTY-INTAKE-SETUP-IA-S515.md
Key code (repo-relative):
  • app/dashboard/properties/page.tsx            — the Rentals list + add/import entry
    (addProperty, importPropertyFromMls, importListingFromImages [DARK], CopyIntakeButton).
  • app/dashboard/properties/actions.ts          — addProperty (thin; draft), publish actions.
  • app/dashboard/properties/[id]/page.tsx        — the detail page; TabPanels in order
    market ("Photos & listing copy") → distribute → setup ("Set up") → assets → inquiries.
  • app/dashboard/properties/[id]/tabbed-sections.tsx — TabbedSections (initialTab, deep-link
    anchor switching, done badges).
  • app/dashboard/properties/[id]/section-deeplink-opener.tsx — deep-link/anchor opener.
  • lib/rental-readiness.ts                       — Link/Photos/Viewings/Feed lifecycle signals.
  • components/description-guide.tsx + lib/listing-description.ts — the guided description writer
    (collapsed under "Help me write this" on the Set up tab).
  • lib/listing-quality.ts, lib/listing-copy.ts   — quality score + per-portal copy.

Context: Agile is the live dogfood operator. The problem (from Noam using it): add captures
minimal details → forced round-trip to complete; the "Set up" tab (core fields) is 3rd, sitting
AFTER "Distribute"; and the Set up panel is ~600 lines / one long wall.

════════════════════════════════════════════════════════════════════════
PART 1 — Independent audit (fresh eyes; do NOT just agree with the doc)
════════════════════════════════════════════════════════════════════════
Walk the actual code and report:
  • Confirm or correct the current tab order + what each tab contains, and where the core unit
    fields, the guided description writer, listing copy, and quality score actually render.
  • The lifecycle/readiness model: how do Link/Photos/Viewings/Feed + the tab `done` checks +
    the draft→publish gate actually sequence a unit? Is the rendered tab order at odds with it?
  • Independently list the top IA/UX problems in this flow — including any the doc did NOT name.
  • Flag couplings that make a change risky: does anything key off tabId strings, `initialTab`,
    deep-link anchors, the child order of TabPanels, or the readiness `done` mapping?

════════════════════════════════════════════════════════════════════════
PART 2 — Critique the scoping doc's 3 options + recommendation
════════════════════════════════════════════════════════════════════════
The doc proposes: A (light: reorder tabs so Set up is first + chunk the long panel), B (medium:
front-load a create wizard, optionally seeded by the MLS/PDF import), C (full: rethink the whole
journey). Its recommendation: ship A first, evaluate B as a fast-follow, park C.
For EACH option assess: does it actually solve the named problems (P1 round-trip, P2 backwards
order, P3 long wall)? Effort/risk realism? Anything it breaks? Then:
  • Answer the doc's §6 open questions concretely from the code (tab-reorder safety; is there an
    intentional reason Distribute precedes Set up; rename "Set up" — safe?; should MLS/PDF import
    BE the wizard step 1; where do Assets/Inquiries belong).
  • Agree or disagree with "A first, then B, park C" — and say why. Propose a 4th option if one
    is better.

════════════════════════════════════════════════════════════════════════
DELIVERABLE
════════════════════════════════════════════════════════════════════════
A concise written review: (1) corrected current-state map, (2) top problems incl. any missed,
(3) per-option critique with effort/risk, (4) concrete answers to the open questions, (5) your
recommendation. No code, no migration, no file edits — this is a design review that Cowork + Noam
will reconcile against Cowork's own read before anything is built.
