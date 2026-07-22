# Distribution Lane B — Realtor.ca Referral Network (Design, S489)

**Date:** 2026-07-14 · **Status:** DESIGN — awaiting Codex review, then build · **Author:** Cowork session S489
**Scope decided with Noam (2026-07-14):** RENTAL-ONLY. Ships DARK behind a flag. NO migration. NO fee/billing code. Manual concierge, no automated agent-matching.

> Productizes the "With a realtor" half of Lane B from `DISTRIBUTION-NEXT-LANES-DESIGN-2026-07-13.md`.
> The Realtor.ca run item's broker handoff gains a second mode: **dispatch a licensed network agent**
> (instead of only "email your own agent"). The external licensed agent is the principal; Vacantless
> is the dispatch + tracking layer. Honest-transport invariants are preserved unchanged.

---

## 1. Why (the gap)

Realtor.ca is not self-serve — a rental reaches it ONLY through a RECO-licensed agent's brokerage
(MLS → DDF → Realtor.ca). Today `realtor_ca` is `mode:"broker"` and the only handoff is *"send the field
sheet to YOUR agent."* Most self-managing Vacantless landlords don't have an agent, so the highest-reach
rental channel in Canada is simply unavailable to them. Lane B closes that by dispatching a network agent.

## 2. The two options (Noam's "FSBO or with a realtor")

The Realtor.ca card becomes a two-option fork:

1. **I have my own agent (default, unchanged):** the current broker handoff — Vacantless prepares the
   field sheet, the landlord emails it to their own agent, agent lists, landlord pastes the live
   Realtor.ca URL. This is exactly today's `mode:"broker"` path. No change.
2. **Dispatch a Vacantless network agent (new, flag-gated):** creates a **concierge-mode** run item on
   `realtor_ca`. Ops matches a partner (licensed) agent → agent lists the rental on MLS through their
   brokerage → agent/ops marks it live with the real Realtor.ca URL → tracked `listing_post`. Never live
   without the URL.

FSBO stays honest: if the flag is off (or the landlord picks option 1 with no agent), the card reads
"requires a licensed agent" — Vacantless never pretends it can post to Realtor.ca itself.

## 3. How it maps onto what's ALREADY built (the reason this slice is small)

The code check (S489) confirms almost all the machinery exists:

- **`realtor_ca` channel** — `lib/distribution-channels.ts`: already `mode:"broker"`, `hasFillSheet:true`,
  `postingPolicy:"broker_only"`. Keep it. The fork is on the run-item mode, not the channel def.
- **Concierge queue** — `distribution_run_items.mode` is a real column; the desk at
  `/dashboard/admin/concierge` (`concierge-actions.ts`, migration `0139_distribution_concierge_queue.sql`)
  already does atomic claim (`.eq("mode","concierge")` + open-status + `concierge_claimed_by IS NULL` CAS)
  and completion. A `realtor_ca` item with `mode:"concierge"` flows through it with **zero desk changes**.
- **Proof gate** — the concierge completion path already calls `validateListingPost({portal, status:"live",
  url})`; a live post with no URL is blocked. The honest "never live without a real ad URL" rule is
  already enforced on this path.
- **Dark-launch flag** — mirror `REFERRALS_ENABLED === "1"` (read in `app/dashboard/layout.tsx`, threaded
  down, nav/card gated). New: `REALTOR_REFERRAL_ENABLED`.

**Therefore: NO migration** (mode is an existing string column; no new table/column). Same posture as
S488/S486.

## 4. Files touched (focused diff)

1. `lib/distribution-channels.ts` — no behavior change; possibly a small pure helper describing the
   two broker-handoff sub-modes for the UI (label/blurb only).
2. `lib/distribution-run.ts` — the `channel.mode === "broker"` branch of the step builder gains a second
   variant: when the chosen handoff is "network agent," emit **agent-facing concierge steps** ("A network
   agent will list this on Realtor.ca", "We'll confirm live and track the link") instead of the current
   "send the field sheet to YOUR agent" steps. Pure step text, keyed by the chosen mode.
3. `app/dashboard/properties/distribution-actions.ts` — when the landlord picks "network agent" (and the
   flag is on), the created `realtor_ca` run item is written with `mode:"concierge"` (today it's broker).
   This is the one behavioral line. Guard: only when `REALTOR_REFERRAL_ENABLED`.
4. `app/dashboard/properties/[id]/launch-run-panel.tsx` + `distribute-tab.tsx` — the two-option control on
   the Realtor.ca card (default "I have an agent"; "Dispatch a network agent (beta)" shown only when the
   flag is on), plus the compliance disclosure copy (§5).
5. `lib/listing-distribution.ts` — **honest-transport hardening (recommended in-slice):** extend the
   proof gate so a `realtor_ca` post marked `live` must have a **realtor.ca host** URL, not merely any web
   URL (today `validateListingPost` only checks `isWebUrl`). Mirrors the S485 per-channel listing
   allowlist / KI760 ("verify each portal's real listing-URL shape up front"). Add `scripts/test-*`.
6. `app/dashboard/layout.tsx` — read `process.env.REALTOR_REFERRAL_ENABLED === "1"`, thread down exactly
   like `referralsEnabled`.
7. `scripts/test-distribution-*.ts` — unit cases: broker→concierge mode fork; the realtor.ca host guard
   (accept a real `realtor.ca/.../<id>` listing URL, reject a bare `realtor.ca/` root and a non-realtor
   host); step-text variant selection.

No change to `completeCopilotPost`, `canMarkCopilotLive`, the S487 reservation, or any migration.

## 5. RECO / CREA compliance (the spine — get the structuring right)

- **The licensed agent is the principal.** The network agent lists on MLS through **their** brokerage.
  Vacantless does not list, does not touch MLS, does not hold trust funds. Product copy says exactly
  that: *"A licensed real-estate agent from our network lists your rental on Realtor.ca through their
  brokerage."* Never *"Vacantless posts to Realtor.ca."*
- **The referral fee is brokerage-to-brokerage.** RECO permits referral fees only between registered
  brokerages, not to an unlicensed party. The fee flows between the partner brokerage and **Noam's
  brokerage** (Royal LePage / Davis Muscovitch Team). **Vacantless the software company is NOT a party to
  the fee and must not represent itself as earning one.** No "Vacantless takes a cut" language anywhere in
  the product. (Billing/fee code is out of scope for S489 entirely — see §6.)
- **The flag is the legal firewall.** `REALTOR_REFERRAL_ENABLED` stays OFF until the RECO referral
  agreement + partner brokerage are actually in place — same principle as the jurisdiction engine's
  "supported-jurisdictions allowlist": informational/manual-only until verified. One env var to go live.
- **CREA consent (Gemini's guardrail):** not triggered here — this is the landlord's OWN rental, so the
  listing is consented by definition. It would only matter if we later DISPLAYED the resulting MLS
  listing back on a Vacantless surface, which requires the CREA DDF feed. Out of scope (§7).

## 6. Reconciliation with Noam's Gemini research (2026-07-14)

- **Gemini method #3 (mere-posting referral swap) = this lane, validated.** Independent confirmation that
  the compliant, cheap path is: refer the landlord to a licensed flat-fee **mere-posting brokerage** that
  lists on MLS, fee brokerage-to-brokerage. Practical effect: the MVP's supply need not be a hand-recruited
  "friendly agent" — an established mere-posting brokerage is a ready fulfillment channel. **The product is
  identical either way (a concierge item), so supply is an ops choice, not a code choice.**
- **Gemini #1 (borrowed listing) and #2 (CREA DDF feed) are a DIFFERENT, INBOUND product — excluded from
  S489.** Those lift/display *other* agents' listings to generate *buyer/renter* leads for Noam personally;
  Lane B is *outbound* (the landlord's own listing → Realtor.ca). Kept out to avoid scope creep; noted as a
  possible future "Realtor.ca lead-gen / DDF display" lane.

## 7. Explicitly deferred (NOT in S489)

- Fee / billing handling (Premium-tier "N MLS listings included" is later).
- Automated agent-matching / a partner-agent roster UI (manual concierge only, like the co-pilot desk).
- CREA DDF display of the resulting MLS listing back on Vacantless (Gemini #2).
- Inbound borrowed-listing lead-gen (Gemini #1).
- Sale-side referral (Noam scoped S489 to RENTAL-ONLY).

## 8. Honest invariants (unchanged, restated for the reviewer)

Never auto-post / auto-login / auto-pay / click-Publish. Never store portal creds. Never mark a channel
live without a real ad URL — and (new hardening §4.5) never from a non-realtor.ca URL for `realtor_ca`.
`completeCopilotPost` remains the only co-pilot Live-write path; the concierge desk's existing
`validateListingPost` gate remains the only broker/concierge Live-write path. The new run-item mode
(`broker → concierge` for the network-agent option) reuses that gate — it does not add an alternate
write path.

## 9. Open questions for Codex

1. Is folding the network-agent option into the **existing concierge queue** (vs a separate "referral
   queue") the right call? (This design says yes — the desk's claim/complete/proof machinery is exactly
   what a referral needs, and one queue keeps the honest gate single-sourced.)
2. Should the realtor.ca host guard (§4.5) ship **in this slice** (recommended — it's the honest-transport
   rule and small) or as a fast-follow?
3. Any RECO-copy concern with the wording in §5 beyond "agent is principal / fee is brokerage-to-brokerage
   / Vacantless earns nothing"?

## 10. Test plan (gates)

`npx tsx scripts/test-distribution-*.ts` (mode fork + realtor host guard + step-text variant); `tsc
--noEmit` clean on-device; Codex runs `next build` + lint on the Mac. Live-QA (read-only, North Star 833
Pillette): the Realtor.ca card shows both options with the flag on, "Dispatch a network agent" creates a
concierge item visible on the desk, the desk completion still refuses a non-realtor / URL-less "live".
Flag OFF by default → nothing changes for existing users.
