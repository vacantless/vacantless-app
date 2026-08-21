> RESOLVED S647 (2026-08-12): ranking SETTLED (broad-Canada) + built + SHIPPED to prod as PR #20 (main 23853f7). New order: Listing sites (kijiji, facebook, rentals_ca, rentfaster, zumper, viewit, realtor_ca=broker rail) + Share & social (facebook_feed, instagram, whatsapp, linkedin, snapchat), 2 display groups. Full settled decision in the claude.ai project KB (same filename) + SESSION_LOG S647. Future slice = resort by per-channel Leads/Booked+.

# OPEN ITEM (for later) — Reorder syndication channels by group + importance (S642)

**Raised:** 2026-08-11 (S642), by Noam. **Status:** backlog / not started. **Priority:** later.

## The ask
The syndication channel ordering should be **regrouped**: put all **social networks together** and
all **listing portals together**, and within each group order the channels **by importance** (most
important first). Today the ordering is mixed / not grouped by channel class.

## Rough grouping (confirm exact membership when picked up)
- **Social networks:** Facebook Page, Instagram, Facebook Marketplace (+ any future social).
- **Listing portals:** Kijiji, Viewit, RentFaster, Zumper, Rentals.ca, Realtor.ca (+ any future
  portal).

## Where it lives (verify on pickup — do NOT assume current order)
- `lib/distribution-channels.ts` — the channel def list / order source of truth.
- The Distribute / "Get online" / Publish-everywhere UI that renders the channel list
  (section-deeplink-opener + the distribute section components). Grouping likely wants visible
  group headers ("Social", "Listing sites").

## Decisions to settle before building
1. **Importance ranking within each group** — Noam to specify (e.g. portals: Kijiji first as the
   proven free flagship; socials: FB Page vs Marketplace vs Instagram order).
2. **Display grouping vs execution order** — does the reorder affect only how channels are
   *displayed*, or also the *publish/autofire sequence*? (Recommend: display grouping first;
   keep execution order decoupled unless there's a reason to sequence.)
3. **Group headers in the UI** — add "Social networks" / "Listing sites" headers, or just order
   without labels?
4. Whether the order is global or per-org configurable (ties to the Relist Radar settings pattern —
   could be another tunable later).

## Notes
- Small, self-contained UX/IA change; good candidate for a single Codex slice once the importance
  ranking (decision 1) is given.
- Not blocking anything current (Relist Radar Slice 1 is the active dispatch).
