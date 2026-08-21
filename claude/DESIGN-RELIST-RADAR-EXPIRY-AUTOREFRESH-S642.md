# DESIGN — Relist Radar: our-data expiry timer → notify → one-click / hands-off repost (S642)

**Date:** 2026-08-11 · **Session:** 642 · **Author:** Cowork (design; build goes to Codex)
**North star:** a landlord never watches an ad die. Vacantless owns the expiry clock from OUR
data, warns before each portal expires, and either refreshes free portals automatically (with a
veto) or gets an affirmative money-consent click for paid ones — then does the repost behind the
scenes at the right moment.

This is S642 option 2 ("expunge-relist + expiry scheduler"), shaped by the Noam consent decision
of 2026-08-11: **free = auto-with-veto is the best course; where money is involved, we want the
consent.**

---

## 1. What already exists (we are stitching, not starting)

- **KI1005 listing-health refresh reminder** — a daily 10am ET cron that emails an age-based "your
  ad needs a refresh" digest; enabled per-org (Agile `921f7c08`, Davis Muscovitch Rentals). **This
  is the timer + email engine we extend** — do not build a second cron.
- **CUT1 one-tap relist** (`RELIST_ONE_TAP_ENABLED`, LIVE global, S640) — the in-app header CTA
  that deep-links to Distribute; live units deep-link, leased units route through the S447
  `?relist=confirm` guard. The email's "Manage" / "Refresh now" links land here.
- **LEASEUP_TAKEDOWN_ENABLED** (app-side take-down, LIVE) — when a unit is LEASED, the ad comes
  down. The scan's LEASED branch reuses this; only the AVAILABLE branch is new refresh behavior.
- **The Kijiji $0 worker path** (S642, `attemptFreePlan`) — headless free repost. This is the
  execution muscle for free portals. Expunge-relist (delete → instant free repost, no cooldown) is
  proven (S641); its cost is a views/age reset (see §5).
- **Consent primitives already modeled**: `distribution_channel_accounts.autopilot_publish_authorized`
  (per org+channel standing consent, S635) and `WORKER_PAY_ONFILE` (paid standing authorization,
  Phase 2). We reuse both rather than inventing new consent columns.
- **Concierge item lifecycle** — `requestConciergePublish` → `authorizeAutopilotSubmit` → worker
  `claimApprovedJob` → `completeConciergeItem` (consumes `external_url`), with
  `distribution_publish_attempts` audit rows. A refresh is just this lifecycle re-driven for an
  already-live item, so we reuse the same terminal states and audit shape.

---

## 2. The consent model in one table

The whole model reduces to two axes: **does the repost cost money**, and **has the org granted a
standing authorization for that portal**.

| Portal type | No standing authorization | Standing authorization ON |
|---|---|---|
| **Free** (Kijiji) | **Auto-with-veto** — email ~N days before expiry: "we'll refresh automatically on <date> unless you skip." No action = refresh. | **Fully hands-off** — refresh at expiry, no email (or a silent FYI receipt). Toggle = `autopilot_publish_authorized`. |
| **Paid** (Viewit $54.95, RentFaster $116.96) | **Affirmative money-consent per cycle** — email: "expires <date>, tap to refresh for $X." No click = the ad lapses (we do NOT spend without a yes). | **Fully hands-off with money pre-authorized** — refresh + charge at expiry. Requires `WORKER_PAY_ONFILE` (Phase 2). |

Two hard invariants fall out of this:
- **Silence never spends money.** A paid portal never auto-reposts on no-response. Only free
  auto-reposts on silence (because it's free and the alternative is the ad dying).
- **Silence never lets a free ad die needlessly** while the unit is still vacant. Free defaults to
  refresh, not lapse.

---

## 3. Architecture — four layers (portal-agnostic where it can be)

### Layer A — Our-data expiry clock (portal-agnostic)
At the moment a portal ad goes live (worker captures `external_url`), record on the run item:
`external_posted_at` (actual post time) and `external_expires_at` (computed = posted_at + that
portal's TTL). Kijiji free TTL = 60 days; each portal carries its own TTL in the channel def
(`lib/distribution-channels.ts`). This is the source of truth — **we do not depend on portal
expiry emails.** (Portal notifications, if they ever arrive, are an optional backup signal only.)

### Layer B — Daily expiry scan (extend the KI1005 cron)
Extend the existing daily job. For each live portal item, compute days-to-expiry. Branch:
- **Unit LEASED** → take-down path (`LEASEUP_TAKEDOWN`), existing. Never refresh a leased unit's ad.
- **Unit AVAILABLE and within the notify lead window (default 3 days to expiry)** → enter the
  refresh flow (Layer C). Only near expiry — never a healthy mid-life ad (see §5).
- **Unit AVAILABLE, not yet in window** → nothing.
The scan is idempotent and single-flight per item+cycle (a per-cycle marker so a re-run never
double-notifies or double-reposts).

### Layer C — Notify + consent surface (per-portal email, portal-agnostic copy engine)
One email can cover several portals, each speaking its own consent language (§2). Sent **3 days** before expiry. Each
portal row carries tokenized, signed, single-use, expiring one-click links scoped to that exact
item+portal+action:
- **Free row:** "Kijiji ad for <address> expires <date>. We'll refresh it automatically that
  morning." Links: **[Skip this one]** (veto this cycle) · **[Manage]** (→ CUT1 in-app). No click =
  auto-refresh on the expiry-day morning. (No "refresh now" button — a confirm would run on the same
  scheduled morning anyway, so silence already means yes; if the landlord wants it sooner they use
  CUT1 in-app.)
- **Paid row:** "Viewit ad expires <date>. Refresh for $54.95?" Links: **[Refresh for $54.95]**
  (the money-consent; only this fires it) · **[Manage]**. The click **confirms consent; the charge +
  repost execute on the expiry-day morning**, not the instant of the click. No click = lapse → a
  post-expiry "your ad expired, tap to repost for $X" nudge (see §4).
If the org has the standing toggle for a free portal, that portal is omitted from the email; those
orgs get a **monthly** "here's what we kept live for you" recap instead of per-event mail.

Token security: HMAC-signed, bound to item id + portal + action + cycle, single-use, short TTL,
server validates and burns on use. A forwarded email cannot repost someone else's listing or fire
twice.

### Layer D — Deferred headless execution
The click authorizes; execution happens at the appropriate moment (the scheduled near-expiry time),
not necessarily the instant of the click — except **[Refresh now]**, which runs promptly.
- **Free (Kijiji):** enqueue a worker **expunge-relist** = the S642 `attemptFreePlan` path.
  Guardrails (§5): back up ad content + photos first, delete old → repost fresh $0 with retry,
  **confirm the new ad is live before marking done**, carry the new `external_url` +
  `external_posted_at`/`external_expires_at` forward. Reuses `completeConciergeItem` as the
  terminal step.
- **Paid:** on money-consent, enqueue the paid repost (Phase 2 `WORKER_PAY_ONFILE`); until Phase 2
  exists, the consent click hands off to the existing manual concierge path so nothing is silently
  dropped. Never auto-charge without the click or standing payment authorization.

---

## 4. State machine per portal item per cycle

Execution always happens on the **expiry-day morning** (the last scan before the ad dies); the
email 3 days prior captures intent, it does not trigger immediate execution.

`live` → (scan: AVAILABLE + within lead window) → `refresh_pending`
- **Free + no veto** (or standing autopilot) → `refresh_scheduled` → (expiry-day morning) worker
  expunge-relist → `refreshing` → confirm live → `live` (clock reset). On worker stop
  (`needs_login`/`captcha`/no free slot) → `needs_operator`, surfaced in Distribute like a manual
  concierge item; the old ad is NOT expunged unless a fresh repost is confirmed (never
  delete-then-fail into a dark listing — see §5).
- **Free + veto (Skip)** → `refresh_skipped`. If the ad still reaches the eve of expiry, send **one
  last-chance email** ("this expires tomorrow — [Keep it live] · [Let it expire]"). [Keep it live]
  → `refresh_scheduled` (runs that morning). No response / [Let it expire] → `expired` (lapse).
- **Paid + money-consent** → `refresh_scheduled` (paid) → expiry-day morning: charge + repost
  (Phase-2 `WORKER_PAY_ONFILE`) or, until Phase 2, hand to the manual concierge path.
- **Paid + no response** → `expired` (lapse) → post-expiry "repost for $X?" nudge.
- **Unit flips LEASED** at any point → take-down, exit refresh flow.

---

## 5. Guardrails / honesty invariants (must hold)

- **Only refresh near expiry.** The views/age reset (S641) is only acceptable at end-of-life: a
  dying ad was about to hit zero anyway, so resetting costs nothing. Never expunge-relist a healthy
  mid-life ad — that throws away live search ranking. The lead-window trigger is what makes the
  reset free.
- **Backup before destruction, confirm before done.** Expunge is destructive (delete → repost).
  Back up content + all photos first (the S641 backup pattern); repost with retry; only mark the
  cycle done once the new ad is confirmed live with a captured `external_url`. Never leave a
  deleted-but-not-reposted (dark) listing. If repost can't confirm, restore/keep the old or leave
  `needs_operator` with the backup intact.
- **Silence never spends money** (paid = affirmative consent or standing `WORKER_PAY_ONFILE` only).
- **Leased never refreshes** — take-down instead.
- **Idempotent + single-flight** — a double cron fire or a double-clicked email never double-posts
  (per-cycle marker + the concierge `concierge_claimed_by IS NULL` claim guard).
- **Fail-closed like the rest of the system** — a worker stop leaves the item visible and
  re-runnable; it never silently drops.
- **Reversible + honest UI** — the standing autopilot toggle is opt-in and revocable; the email
  always offers skip/manage; copy states plainly what will happen and when.

---

## 6. Slicing (dark-flag each)

1. **Slice 1 — the clock (dark).** Record `external_posted_at` + `external_expires_at` at post
   time per portal item; add per-portal TTL to the channel def. Extend the KI1005 scan to *detect*
   near-expiry AVAILABLE items and log them (no email, no execution yet). Proves the timer from our
   data. Additive migration (two nullable columns), no backfill.
2. **Slice 2 — the email surface.** Per-portal rows with tokenized one-click links; free =
   auto-with-veto copy, paid = money-consent copy. Sends but execution still dark (links record
   intent only). Prove the consent capture + token security.
3. **Slice 3 — free execution + standing toggle.** Wire the free auto-with-veto path to the S642
   worker expunge-relist (guardrails §5); add/reuse the `autopilot_publish_authorized` standing
   toggle to suppress the email and go fully hands-off. Prove one real $0 auto-refresh on the test
   org end to end.
4. **Slice 4 — paid execution (Phase 2).** `WORKER_PAY_ONFILE` standing authorization + per-cycle
   money-consent execution for Viewit/RentFaster. Depends on the paid-autofire build.

Each slice is shippable and provable alone; Slice 1 unblocks everything and is the smallest.

---

## 7. Resolved decisions (2026-08-11) — all stored as configurable org settings

Every one of these is a **per-org setting with the decided value as the default**, not a hardcoded
constant — so they're tunable later via a settings UI (and eventually per-portal) with no code
change. Persist them in a `relist_radar_settings` shape (per-org row / JSON), read by the scan +
email + execution layers.

| Setting | Default (decided) | Later-configurable |
|---|---|---|
| `notify_lead_days` | **3 days** before expiry | yes; per-portal later |
| `refresh_now_semantics` | **confirm → execute on expiry-day morning** (email click captures intent; execution deferred) | yes |
| `free_skip_behavior` | **one last-chance email on expiry eve, then lapse** | yes (alt: quiet-lapse) |
| `paid_lapse_followup` | **post-expiry "repost?" nudge** | yes (alt: rely on in-app CUT1) |
| `execution_time` | **expiry-day morning** (last scan before death) | yes |
| `email_grouping` | **one combined Relist Radar email per property** | yes |
| `autopilot_receipt` | **monthly recap** for hands-off orgs | yes |
| `autopilot_publish_authorized` (free) / `WORKER_PAY_ONFILE` (paid) | **off / opt-in**, per org+channel | yes |

Build Slices 1–3 to read these from the settings row (defaults applied when unset). The settings
**UI** to edit them is a later slice; the values ship as defaults now.

### Still genuinely open (not blockers; can default and revisit)
- Per-portal override granularity (ship org-level now, per-portal knobs later).
- Exact monthly-recap format/day.

---

## 8. What to build first
Slice 1 is a clean, low-risk Codex handoff (two columns + a per-portal TTL + a scan extension, all
dark). It turns "we depend on portal emails" into "we own the clock," which is the foundation the
whole Relist Radar stands on. Recommend cutting that handoff next.
