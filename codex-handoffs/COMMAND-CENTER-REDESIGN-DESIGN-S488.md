# Distribute → One Command Center — Redesign Design (S488)

**Date:** 2026-07-14 · **Status:** DESIGN — locks IA before code · **Author:** Cowork S488
**Trigger:** Codex UX review of the Distribute page (first-time-user walkthrough, 6 findings).
**Decision (Noam, S488):** design doc first → **Slice 1: command-center simplification** →
extension UX in **Slice 2**. Helper window is the primary path; no landlord-facing "Install
extension" promise while the extension is unpacked-only.
**Review status:** **ACCEPTED by Codex** (no P1/P2 design blockers). Two P3 nits folded below
(§5: carry the grid's `problem` state forward as a red "needs ad URL" row; override the `submitted`
tone). Four open questions resolved (§11). Ready for the Slice 1 build.

> This doc locks the information architecture and the exact per-channel card states so the Slice 1
> fold is a pure layout / progressive-disclosure / copy change on `distribute-tab.tsx` +
> `copilot-panel.tsx` (and one small `page.tsx` reorder). **No server path, no honesty gate, and no
> migration is touched.** Nothing here is built yet.

---

## 1. Problem — confirmed in code, not just felt

The Distribute tab (`app/dashboard/properties/[id]/distribute-tab.tsx`, 1,073 lines) renders **two
stacked surfaces**:

1. **`LaunchRunPanel`** ("Publish checklist") — the guided, resumable posting session: pick channels →
   work each as a checklist → paste the live URL. This is the intended flow.
2. **A second channel-by-channel grid below it** — `ChannelCard`s with Open-portal / Copy / reply
   snippets, `PostRow` tracked links, the "+ Track a live ad" `AddPostForm`, plus `AnalyticsPanel`,
   `ListingQualityPanel`, and `PartnerSection` (feed setup).

That is the "**which part am I supposed to use?**" problem (Codex #2), and it is doubled at the data
layer: the two surfaces speak **two different status vocabularies** —

- `LaunchRunPanel` uses **`PublishStatus`** (`lib/distribution-publish.ts`): `blocked · queued ·
  submitting · submitted · needs_operator · needs_login · needs_payment · live · rejected · skipped`.
- the grid uses **`ChannelStatusValue`** (`lib/distribution-channels.ts`): `not_started · ready ·
  posted · needs_refresh · problem`.

Only the grid knows about **`needs_refresh`** (stale/expired), because staleness is derived from
`listing_posts` age, which the run item view never carries. Unifying the two vocabularies onto one
card is the core technical move of this redesign (see §5, §6).

On top of that, the property page (`page.tsx`) renders the **`LifecycleRail`** — with the current
lifecycle step (often "Prepare the lease") expanded — **above** `TabbedSections`, and **"Distribute"
is the *second* tab** (after "Photos & marketing"). So a user who came to publish lands on lifecycle
progress and lease prep before the publishing controls (Codex #1).

And the opened guided card (`copilot-panel.tsx`) stacks: honesty bullets → open portal → helper
window → extension → title copy → description copy → rent → address → tracked link → 7-step checklist
→ proof form → status editors. Safe, but "not calm" (Codex #3/#4/#5).

---

## 2. Goal

**Distribute is one command center, not a checklist plus an old where-posted stack.** One surface,
one status vocabulary per channel, one recommended action at a time. Everything that is an
operator/admin tool (tracked-link editors, reply snippets, add-proof, advanced status, analytics,
partner setup) is present but **collapsed and out of the primary path**.

## 3. Primary user path (the promise)

> **Choose channels → follow one next action → paste the live URL when posted.**

Every screen state answers exactly one question: *what do I do next on this channel?* — and offers one
button that does it. The machinery underneath (proof, verification, tracked links, status overrides)
stays available behind "More actions", never in the first read.

## 4. Rules / invariants (non-negotiable)

1. **No duplicate per-channel surfaces.** After Slice 1 there is exactly one place per channel. The
   old `ChannelCard` grid stops being a parallel action surface; its *tools* move into a collapsed
   "Posted links & tools" section (§6).
2. **No extension install promise.** The extension is unpacked-only (not on the Chrome Web Store), so
   nothing landlord-facing says "Install extension". The extension path appears **only when detected**
   (the existing `extReady` ping already gates it) and is labelled as a beta courier. Full
   install/detection UX is **Slice 2**, gated on the extension being packaged enough that a
   first-timer can actually get it.
3. **Proof-before-Live is preserved, byte-for-byte.** `completeCopilotPost`, `canMarkCopilotLive` /
   `copilotLiveUrlIssue` (the S485 positive listing allowlist), the S482 P1 `!item.copilotScript`
   guard (which hides the generic status form for co-pilot items so it can't bypass the proof path),
   and the reservation/attribution logic (S487) are **untouched**. This is a UI-only slice.
4. **No new server surface, no migration.** Every change is in the three UI files below plus a small
   `page.tsx` reorder and pure data-shaping. `distribution-*.ts` libs, `actions.ts`,
   `distribution-actions.ts`, and `concierge-actions.ts` are not edited.

---

## 5. Exact card states (the operator-facing model)

Slice 1 collapses the two vocabularies into **one derived card state** per channel, with one tone and
one primary action. This is the contract the command center renders against.

| Card state | Derived from | Tone | What the card shows | The one primary action |
|---|---|---|---|---|
| **Queued** | `publish_status = queued` (in the run, nothing done) | neutral | Channel name + mode + "Queued" | **Open helper window** (guided) / **Start** for our own surfaces |
| **Needs sign-in / payment** | `publish_status ∈ {needs_login, needs_payment}` | amber | "You sign in / pay on the site — Vacantless stops here" | **Open helper window** (login/payment happens in the operator's own session) |
| **Ready to post** | `publish_status = needs_operator` (copy prepared, operator action available) | neutral→brand | "Copy is ready. Post it, then paste the live URL." | **Open helper window** (primary) · **Open ‹Channel›** (secondary) |
| **Posted / Live** | `publish_status = live` (real ad URL on file) | green | "Live" + tracked inquiry link | **View live ad** · (tracked-link tools under More actions) |
| **Needs refresh** | `listing_posts` staleness → `ChannelStatusValue = needs_refresh` (live but stale/expired/removed) | amber | "Live ad is stale — repost or refresh" | **Open helper window** to repost |
| **Blocked** | `publish_status ∈ {blocked, rejected}` (share not ready / prerequisite missing / rejected) | red | The single top blocker | The action that clears it (e.g. **Finish photos**, **Set up feed route**) |
| **Needs ad URL** *(carried from the grid — Codex P3)* | `ChannelStatusValue = problem` (a row is marked live but has no ad URL) | red | "Marked live but has no ad URL — add it so the tracked link works" | **Add the ad URL** |

**Codex P3 — do not drop `problem`.** The old grid has a defensive red state for a live-without-URL
row (`ChannelStatusValue = problem`, `distribution-channels.ts:164`, rendered at
`distribute-tab.tsx:436`). Retiring the grid **must** carry this forward: a legacy/corrupt
live-without-url row must render as the red **Needs ad URL** row above, never as ordinary **Live**.
It folds into the Blocked/Error visual family with a specific "add the ad URL" action.

Transient / secondary states:

- **Submitting / working** (`submitting`) → a "working…" affordance on the same row, not a distinct
  card design.
- **Submitted to feed** (`submitted`, feed_partner) → **Codex P3:** the doc reuses the existing tone
  maps, but `submitted` is `positive` in `distribution-publish.ts:76`, which would read as Live. For
  this state **override** to **neutral/amber**, label it **"Submitted to feed — not live yet"**, and
  render **no live-ad actions**. Submitted is never rendered as Live.
- **Skipped** (`skipped`) → row muted, reopenable under More actions.

**Key merge decision:** `needs_refresh` today lives only on the old grid because the run item view
(`RunItemView`) has no `lastPostedOn`/staleness. To show it on the command-center row, `page.tsx`
passes the already-computed `listing_posts`-derived staleness into the run item view. This is **pure
data-shaping in `page.tsx`** (both values are already fetched there) — **no schema change, no
migration.**

Colors reuse the existing tone maps (`STATUS_CHIP` in `launch-run-panel.tsx`, `CHANNEL_STATUS_TONES`
in `distribution-channels.ts`) so the chip tone and the derived state never disagree.

---

## 6. Information architecture — the single command center

Top to bottom, when the Distribute tab is active:

1. **Next-action banner (new, top).** One line: the single most important next step across all
   channels — e.g. *"Post on Facebook next"* or *"Finish Viewit proof"* or, when all done, *"All
   channels live — nothing to do."* Derived purely from the run items' card states (first
   non-resolved by priority). No new data.
2. **Compact channel rows (the merged surface).** One row per channel in the run: name · mode · **one
   status chip (§5)** · **one primary button** · a small **"More"** menu. Collapsed by default.
   - **Opened row** shows **one path by default** — the guided **helper-window** flow — not helper +
     extension + inline copy all at once. Copy fields live inside the helper-window path (the sidecar
     already renders the same copy), not as a tall inline block.
   - The **channel picker** ("choose channels", start/add) stays here — this is the "choose channels"
     step of the promise.
3. **"Posted links & tools" (new collapsed section, bottom).** Everything from the old grid that is a
   tool, not a step: per-channel **tracked links** (`PostRow` + `CopyLink`), **reply snippets**,
   **"+ Track a live ad"** (`AddPostForm`, the manual custom-post path), **analytics**
   (`AnalyticsPanel`), **listing quality** (`ListingQualityPanel`), and **feed-partner setup**
   (`PartnerSection`). Present for power users, out of the first read.
4. **Per-row "More actions"** (replaces the always-open editors): **Add proof / check again**
   (`recordItemProof`), **Advanced status update** (`updateRunItem`, non-copilot only — the S482 P1
   guard stays), **Ask Vacantless to post it** (concierge), **Cancel this channel**. Hidden until the
   user asks for them.

### 6.1 What moves / collapses (element-by-element)

| Element (today) | Where it is now | After Slice 1 |
|---|---|---|
| `LaunchRunPanel` "Publish checklist" | top of tab | **becomes THE command center** (rows in §6.2) |
| Old `ChannelCard` grid (Open portal, Copy, status) | second surface below | **removed as an action surface**; its tools relocate below |
| Reply snippets (`buildReplySnippets`) | inside each `ChannelCard` | → "Posted links & tools" (collapsed) |
| Tracked links / `PostRow` / `CopyLink` | inside each `ChannelCard` | → "Posted links & tools" (collapsed) |
| "+ Track a live ad" (`AddPostForm`) | inside each `ChannelCard` | → "Posted links & tools" (collapsed) |
| `AnalyticsPanel` | Distribute tab | → "Posted links & tools" (collapsed) |
| `ListingQualityPanel` | Distribute tab | → "Posted links & tools" (collapsed) |
| `PartnerSection` (feed setup) | Distribute tab | → "Posted links & tools" (collapsed) |
| "Add proof / check again" (`recordItemProof`) | always-open `<details>` in each run item | → per-row **More actions** |
| "Advanced status update" (`updateRunItem`) | always-open `<details>` (non-copilot) | → per-row **More actions** (guard preserved) |
| CopilotPanel copy grid + 7-step list | inline, tall | → **inside the helper-window path** (§6.3) |

### 6.2 Channel row (Slice 1 target)

Collapsed: `‹icon› Facebook Marketplace · Guided posting · [Ready to post] · [Open helper window ▸] · [More]`

Opened (Ready to post): the honesty line, the **primary** *Open helper window (no install)*, a
**secondary** *Open Facebook Marketplace*, and the **Live ad URL** proof field. The bulk copy and the
step list render **in the helper window**, not inline.

### 6.3 Channel card behavior (per Noam, Slice 1)

- **Primary button: Open helper window** — the S484 same-origin sidecar. Works now, every browser, no
  install. It already shows the same channel-fit copy + the mark-live form.
- **Secondary: Open ‹Channel›** (Facebook / Kijiji / Viewit) in a new tab.
- **Copy fields live inside the helper-window path**, not as huge inline cards.
- **Extension path is hidden by default** — shown **only when detected** (the existing `extReady`
  ping). When detected: a small secondary **"Send to Chrome extension (beta)"**. When **not** detected:
  **nothing** — no "Install extension" for normal users in Slice 1.
- The proof form ("I posted it — mark live with this URL") stays as the completion step, unchanged.

### 6.4 Lead with publishing (Codex #1)

The `LifecycleRail` + expanded lease step render above `TabbedSections`, and Distribute is the second
tab. Lightest honest fix in Slice 1: when the Distribute tab is the active tab, render the lifecycle
rail in a **compact/summary** form (thin status strip, current step not auto-expanded) so the command
center leads. This is a `page.tsx` / `lifecycle-rail` presentational change only — the rail keeps all
its deep-links; it just doesn't push the publishing controls down when the user is here to publish.
*(If we want to keep this slice strictly inside `distribute-tab.tsx`, this item can move to Slice 1b;
flagged as the one page-level touch — see §10.)*

---

## 7. Extension — why it is Slice 2

Codex asked for an explicit "Install extension?" affordance with detection states (install /
"I installed it – try again" / detected / failed). That is the right end state, but it presumes an
**installable** extension. Ours is loaded unpacked from disk — a first-time landlord cannot "get it".
Shipping an Install button now creates a promise we cannot cleanly fulfill (Rule §4.2).

**Slice 1** therefore: helper window primary; extension shown **only when already detected**, as a
beta courier; no install path. **Slice 2** (separate, later): the real two-path install/detection
story — but its true prerequisite is **packaging the extension for the Chrome Web Store** (or a
signed, self-hostable install) so the "Install" button points at something real. Until then, the
helper window *is* the no-install path and the page is fully usable without the extension.

---

## 8. Mapping to Codex's six findings

| # | Codex finding | Addressed by |
|---|---|---|
| 1 | Distribute work starts too low (lifecycle + lease first) | §6.4 compact lifecycle rail when Distribute active |
| 2 | Two distribution surfaces ("which do I use?") | §6 single command center; §6.1 old grid tools → collapsed |
| 3 | Guided card too tall | §6.2/§6.3 copy + steps move into helper window; one path by default |
| 4 | Primary action not obvious | §5 one primary action per card state; §6.3 Open helper window primary |
| 5 | Advanced/operator controls too present | §6/§6.1 Add-proof + Advanced-status + tools → More actions / collapsed |
| 6 | Extension not discoverable / unanswered questions | §6.3 + §7: detected-only beta button in Slice 1; honest install story deferred to Slice 2 |

---

## 9. Honesty / invariants preserved (explicit)

Untouched by Slice 1: `completeCopilotPost` (only co-pilot Live-write path), `canMarkCopilotLive` /
`copilotLiveUrlIssue` (S485 positive listing allowlist), the S482 P1 `!item.copilotScript` guard, the
S487 reservation + `submit_public_lead` `?p=` attribution, `recordItemProof`, `verifyPublicPage` /
`verifyOrgFeedInclusion`, and all of `actions.ts` / `distribution-actions.ts` /
`concierge-actions.ts`. **No migration.** The "never live without a real ad URL / never from a
non-listing URL" contract holds because the completion form and its server action are moved in the
DOM, not modified.

---

## 10. Slice 1 scope, files, and verification

**In scope (Slice 1 — command-center simplification):**
- `distribute-tab.tsx` — merge the two surfaces into one command center; move old grid tools + reply
  snippets + tracked links + add-post + analytics + listing-quality + partner into a collapsed
  "Posted links & tools"; add the top next-action banner.
- `launch-run-panel.tsx` — compact channel rows; one primary action per §5 card state; move Add-proof
  + Advanced-status into a per-row "More actions" (preserve the `!item.copilotScript` guard); consume
  the merged `needs_refresh` staleness.
- `copilot-panel.tsx` — helper window primary; Open-‹Channel› secondary; copy + steps into the helper
  path; extension button detected-only, relabelled "Send to Chrome extension (beta)".
- `page.tsx` (+ maybe `lifecycle-rail`) — compact lifecycle rail when Distribute is active; pass
  `listing_posts` staleness into the run item view (pure data-shaping, no migration). *(Optionally
  Slice 1b if we want Slice 1 confined to the tab.)*

**Out of scope (Slice 2):** real extension install/detection UX (prereq: Web-Store packaging); any
Realtor.ca-referral work (separate queued lane).

**Verification plan:**
- `tsc --noEmit` clean on-device; Noam runs the build gate + `next build` + tsx tests on the Mac.
- The existing distribution test scripts (channels / copilot / publish / run) stay green — this is
  UI-only, so no pure-lib behavior changes; add none unless a helper is extracted.
- Live-QA on North Star (833 Pillette) via Claude-in-Chrome, read-only: confirm one command center,
  one primary action per channel, proof-before-Live markers still render, helper window opens with
  the copy, extension button absent when not installed, nothing posted / nothing marked live.
- Codex code review of the Slice 1 diff after this design is accepted.

---

## 11. Resolved by the design review (Codex, S488)

1. **Lifecycle rail (Codex #1):** **include compact-when-Distribute-active in Slice 1** — it is the
   thing pushing the command center down today. (Not split to 1b.)
2. **Next-action banner scope:** **one banner across all channels**, prioritized by the single most
   important unresolved action.
3. **"Posted links & tools" granularity:** **two collapsed sections** — (a) per-channel posted
   links/tools, then (b) performance/setup (analytics · listing quality · feed-partner). One drawer
   risks becoming another long confusing surface.
4. **`needs_refresh` on the command-center row:** **surface it now as a card state** — it already
   exists and needs no schema work.
