# Codex QA Handoff — S484 no-install pop-out SIDECAR (Lane C)

**Commit:** `4f187e3` (parent `00feeb5` = S483). No migration. 4 files, +555.
**Gates run on device:** `tsc --noEmit` clean; `test-distribution-copilot` 57/0.
**NOT run on the bridge:** full `next build` (45s device shell cap; backgrounded
builds are reaped by the workspace VM). Run `npm run build` locally before deploy.

## What shipped
A no-install alternative to the S483 Chrome extension (design:
`SIDECAR-NOINSTALL-DESIGN-S483.md`). From the co-pilot panel, "Open co-pilot
window" opens a **same-origin** companion window
`/dashboard/properties/[id]/copilot/[itemId]` that shows the same channel-fit
copy + ordered steps and completes the post by pasting the live URL. It reuses the
EXISTING `completeCopilotPost` server action — **no bridge, no nonce, no content
script, no new server surface, no new endpoint/table**.

### Files
- **NEW `lib/copilot-sidecar.ts`** — `loadCopilotSidecar({propertyId,itemId,publicUrl})`.
  Rebuilds the SAME pure `CopilotScript` the Distribute tab builds (page.tsx), for
  one run item, reusing `resolveEffectiveFeatures` / `resolveBuildingProfile` /
  `buildCopilotScript` / `buildTrackedLink` / `isPublicBookable`. `import "server-only"`.
- **NEW `app/dashboard/properties/[id]/copilot/[itemId]/page.tsx`** — server route;
  `headers()`→publicUrl, `loadCopilotSidecar`, `notFound()` on null, renders `<SidecarCopilot>`.
- **NEW `app/dashboard/properties/[id]/copilot/[itemId]/sidecar-copilot.tsx`** —
  client shell: copy fields + honesty + blockers + steps + `completeCopilotPost` form.
- **EDIT `app/dashboard/properties/[id]/copilot-panel.tsx`** (+29) — adds an
  always-visible "Open co-pilot window (no install needed)" button (`window.open`).
  S483 extension bridge code untouched.

## Review focus (novel surface = a new same-origin route feeding the S482b-closed completion)
1. **Cross-org isolation in the loader.** All ids are RLS-derived: run item → run →
   property → org → building policy all read through the org-scoped `createClient()`.
   The URL's `propertyId` is confirmed to equal the run's OWN `property_id` before
   the script is built. Confirm no client-supplied id is trusted and no read can
   cross orgs.
2. **Does the sidecar reopen the S482b P1 "live without proof" gap?** It should not —
   the completion form posts ONLY to `completeCopilotPost`, which re-validates the
   URL (`canMarkCopilotLive`), rejects a non-active run / concierge item, and does
   the CAS reservation + terminal-flip-last. There is NO `updateRunItem` path here.
3. **Guard parity.** `loadCopilotSidecar` returns null on exactly the states
   `completeCopilotPost` refuses (not found / wrong property / not a co-pilot
   channel / no active run / concierge), so the sidecar never invites a post the
   server would refuse.
4. **CopilotScript parity** with the Distribute tab for the same item — same
   `effectiveFeatures` (building-over-org policy inheritance), same tracked-link
   rule (`linkIsLive && listing_post_id ? tracked : linkIsLive ? publicUrl : null`).
   If they can diverge, factor page.tsx's builder into the shared loader.
5. **Honest invariants** unchanged: operator copies/posts/marks-live; Vacantless
   never posts, submits, or stores a login. No credentials anywhere.

## Known v0 UX limitation (not a correctness issue)
`completeCopilotPost` redirects to `/dashboard/properties/{id}?dist=copilot_live#distribute`;
in the pop-out that loads the full property page in the small window (main tab
stale until refresh). Acceptable for v0. A v1 close-window landing can be added
without touching the proof-gate.

## Sequencing
S480–S483 CLOSED (do not reopen). After this: extension v1 per-field auto-fill →
Realtor.ca referral → N-forms.
