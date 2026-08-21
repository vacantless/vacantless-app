# CODEX PROMPT — "Get it live" flow-friction cuts (CUT 1 / CUT 2 / CUT 3) — S638

> Mirror of the on-disk handoff at `vacantless-app/claude/CODEX-PROMPT-FLOW-FRICTION-CUTS-S638.md` (rule 36). Design of record: `claude/DESIGN-GET-IT-LIVE-FLOW-FRICTION-S638.md` (+ the curtain principle in `claude/DESIGN-PUBLISH-GET-IT-LIVE-CURTAIN-S636.md`). Noam approved all three cuts (S638).

Grounded on `vacantless-app` main @ `c1e5a51` (verify `git rev-parse --short HEAD`). Branch from `main`, NOT the parked `codex/s629-inquiry-phone-settings-toggle` branch (its work is merged). Verify all line numbers below against current `main` — they are anchors, not guarantees.

## DISPATCH ORDER — do these in sequence, one PR each, merge before the next
CUT 1 → CUT 2 → CUT 3. They touch overlapping files (`distribute-tab.tsx`, `copilot-panel.tsx`, `publish-everywhere.tsx`), so running them in parallel will conflict. Each is additive, flag-gated dark, and has NO migration and NO new server action unless stated. Do NOT flip any flag in prod — Noam flips after review + native lint/build (KI1030: `next lint`/`next build` do NOT run in the on-device Linux VM; only `npx tsc --noEmit` does).

## Shared persona / honesty rule (all three cuts — do not violate)
Anyone (elderly / ESL / busy) gets a listing live without seeing mechanism. The person is ever asked for exactly TWO things — **sign-in** and **pay** — and nothing else. The curtain hides mechanism, never consent. Nothing posts before the preflight confirm (KI999). The extension/desk/app never posts, signs in, pays, OR marks a channel live for the landlord. "Instant" only for connected/authorized/accepted channels; "we post for you" only for copilot-capable. Reach "included" = instant + for-you, never the raw channel count.

---

## CUT 1 — One-tap relist entry (highest leverage; = curtain Slice 5 pulled forward)

### Problem
Re-posting an already-live listing costs ~10 taps + ~4 scrolls (Rentals → open unit → Get online tab → scroll → Advanced/More options → scroll → Open 1-tap queue → Details → Start guided posting). For a relist the person should not touch any intermediate surface.

### Goal
From the property header AND from the listing-freshness nudge, ONE tap drops the person directly onto the guided post for the stale channel(s): the `#publish-checklist` section, scrolled into view with the target channel's `copilot-panel.tsx` block expanded and its "Start guided posting" reachable in one tap. No new posting path — reuse the existing re-publish + guided-posting plumbing.

### Scope — build exactly this
1. FLAG. Add `RELIST_ONE_TAP_ENABLED` (default OFF). Flag OFF ⇒ renders exactly as today.
2. HEADER CTA. In `app/dashboard/properties/[id]/page.tsx` near the existing "Duplicate this property" button (~L2284), add a primary "Relist / refresh this ad" CTA, shown when the listing is Live (and honoring the existing S447 "Relist anyway" guard for leased units — do NOT bypass it). The CTA links to `#publish-checklist` (optionally `#publish-checklist?channel=<key>` — see step 4).
3. DEEP-LINK REUSE. Use the EXISTING deep-link machinery — `section-deeplink-opener.tsx` (resolves `window.location.hash` → `getElementById` → `scrollIntoView` + auto-open) and/or `tabbed-sections.tsx` (same pattern) — to land on `#publish-checklist` (anchor already exists at `launch-run-panel.tsx:378/450`). Do NOT hand-roll a new scroll/anchor system.
4. CHANNEL FOCUS (optional but preferred). Extend the deep-link so a channel key (e.g. `#publish-checklist` + a `channel` query/hash param) auto-expands that channel's `copilot-panel.tsx` guided block (the Kijiji/Facebook "Details" state) instead of leaving the person to find it. If cross-component state makes this fragile, ship step 2+3 (land on the checklist) and leave per-channel auto-expand as a follow-up — but say so in the PR.
5. FRESHNESS NUDGE. Wire the listing-freshness path (`app/api/cron/distribution-freshness`, the daily 10am ET listing-health digest) so its "this ad needs a refresh" CTA deep-links to the same header relist entry (the digest already emails; point its link at `#publish-checklist` for the flagged listing). If the digest link target is templated server-side, update the template; do NOT change the cron schedule or the digest's selection logic.

### Out of scope
No change to `publishProperty` (actions.ts:1098) semantics, `openGuidedPosting`, `completeCopilotPost`, `resolvePublishMode`, or the S447 relist-guard. No migration. No new server action.

### Gate
`npx tsc --noEmit` clean · `npm run lint` (only the known `app/job/[token]/page.tsx` `<img>` warning) · `npm run build` green · flag OFF renders byte-identical · deep-link lands on `#publish-checklist` (and, if built, auto-expands the channel) · `git diff --check` clean.

### Deliver
Branch + PR. Report flag name, files touched, whether per-channel auto-expand (step 4) shipped, gate output.

---

## CUT 2 — Extension-first default path

### Problem
When the extension IS present, its auto-fill + auto-capture path is a small "Send to Chrome extension (beta)" button BELOW the big "Start guided posting" (which opens the manual no-install sidecar), so extension users still get funneled to the high-friction manual path. When the extension is ABSENT, nothing frames installing it as the one-time unlock.

### Context (verified S638 live walk)
In `app/dashboard/properties/[id]/copilot-panel.tsx`: `openSidecar` opens the no-install window; `sendToExtension` mints a nonce and posts `copilot_job`; the **"Send to Chrome extension (beta)" button is `{extReady && (…)}`** (only shows once the extension answers the app ping with a pong). The sidecar (`sidecar-copilot.tsx`, "NO INSTALL NEEDED") deliberately has no gesture — leave it as the fallback.

### Goal
When `extReady` is true, the extension path is the PRIMARY CTA; the manual "Start guided posting" (sidecar) is demoted to a secondary link. When `extReady` is false, a calm one-time "install the helper once → relists become near-instant" nudge appears (dismissible, not nagging), with the no-install sidecar still one tap away.

### Scope — build exactly this
1. FLAG. Add `EXTENSION_FIRST_COPILOT_ENABLED` (default OFF). Flag OFF ⇒ current ordering.
2. `extReady === true`: promote the extension action to the primary CTA (relabel to something like "Fill it on {channel} + bring the URL back", drop "(beta)"); demote "Start guided posting" to a secondary text link. Behavior of `sendToExtension` UNCHANGED.
3. `extReady === false`: render a calm, dismissible one-time install nudge ("Install the Vacantless helper once — then every relist auto-fills and brings the live URL back. You still sign in and post."), honest (never implies Vacantless posts for them), with the sidecar ("Start guided posting") remaining the visible fallback CTA.
4. No change to `sendToExtension`, the `captured_url` contract, `openSidecar`, or `completeCopilotPost`. Reorder/relabel + the nudge only.

### Out of scope
No auto-post / auto-mark-live (Slice-2 decision stands: auto-fill + ONE-TAP confirm). No sidecar changes. No install/distribution mechanics (the extension is unpacked-only today — the nudge is copy + a link/instructions Noam supplies, not an install button).

### Gate
`npx tsc --noEmit` clean · lint (known warning only) · build green · flag OFF byte-identical · with a mocked `extReady=true` the extension CTA is primary; with `extReady=false` the install nudge renders and the sidecar fallback still works · `git diff --check` clean.

### Deliver
Branch + PR. Report flag name, files touched, gate output.

---

## CUT 3 — Trim the pre-live surface (curtain the mechanism)

### Problem
Before anything is live the person sees channel counts, "2/14", instant/for-you/after-setup buckets, rails, and status chips — mechanism the curtain is meant to hide. Slice-1 made `PublishEverywhere` the default but numeric mechanism still shows above "Advanced / More options".

### Goal
Under the existing GLOBAL flag `PUBLISH_SIMPLE_DEFAULT_ENABLED`, the default view shows only: the listing, one "Get this listing live" action, and — after the run — "you're live" + the links. ALL numeric mechanism (reach counts, the 2/14 ring, the three-bucket rail preview, status chips) moves entirely behind "Advanced / More options". The front-loaded preflight (`ConfirmModal`, Slice-1) remains the only gate.

### Scope — build exactly this
1. Audit what renders ABOVE the "Advanced / More options" `<details>` in `app/dashboard/properties/[id]/distribute-tab.tsx` (`DistributeTab` L384) and `publish-everywhere.tsx` (`PublishEverywhere`, `ConfirmModal`) when `PUBLISH_SIMPLE_DEFAULT_ENABLED` is on.
2. Push remaining numeric mechanism (the reach counts / "X/14" ring from `summarizeReach` in `lib/publish-everywhere.ts`, the bucket-rail preview, status chips) BELOW the Advanced disclosure. Keep above the fold ONLY: the listing summary, the single "Get this listing live" CTA, the two allowed asks when they occur (sign-in, pay via the preflight), and the post-run "you're live" + links.
3. Do this behind the SAME flag (no new flag) — it refines the Slice-1 default. Delete nothing; relocate.

### Out of scope
No change to `resolvePublishMode`, `derivePublishPreflight`, the preflight gate semantics, or honesty invariants. Reach "included" = instant + for-you (never raw count). No migration, no new server action.

### Gate
`npx tsc --noEmit` clean · lint (known warning only) · build green · with `PUBLISH_SIMPLE_DEFAULT_ENABLED` OFF byte-identical to today · with it ON, no numeric mechanism renders above Advanced; the preflight still gates; post-run shows links · `git diff --check` clean.

### Deliver
Branch + PR. Report files touched, exactly what moved below Advanced, gate output.
