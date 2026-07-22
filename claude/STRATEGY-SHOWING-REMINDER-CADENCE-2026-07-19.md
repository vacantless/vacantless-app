# STRATEGY — Showing-reminder cadence + channel coordination (what the best products do) — 2026-07-19

**Question (Noam):** the day-of reminder + SMS needs to work hand-in-hand with email — what's the *best* strategy? Grounded in a randomized trial + what ShowMojo, Calendly, BrokerBay, and the appointment-reminder field actually do.

## 1. What the evidence + competitors converge on

**(a) Two spaced reminders beat one — that's the ceiling worth chasing.**
- AJMC randomized trial, 54,066 patients: two reminders (3-day + 1-day) missed **4.4%** vs one-reminder 5.3–5.8%; highest-risk quartile benefited most (NNT 25); extra reminder did **not** hurt satisfaction. Text and phone equally effective; text primary.
- Calendly's no-show guide: send **"at least two"** — examples 24h + 30 min.
- Takeaway: a **day-ahead touch + a near-time touch** is the backbone. More = diminishing returns.

**(b) Combine email + SMS, but assign each to what it's good at.**
- Calendly: use **"a combination of email and texts"** (multi-device reach).
- Vital Interaction: **email = substance but lacks urgency; SMS = preferred + timely; voice = last resort.** Inside 48h, shift from "reschedule?" to "make sure you attend."
- Takeaway: **email carries the day-ahead detail + reschedule; SMS carries the day-of urgency.** Don't fire both at the same instant.

**(c) The biggest lever is a CONFIRMATION ask with the action IN the message — targeting the attendee.**
- **ShowMojo:** requires prospects to **confirm**; text rewritten to be blunt — **"action is required to avoid cancellation"**; confirm-at-property before access code; custom post-showing follow-up.
- **Calendly:** **reconfirm workflow** — email button / SMS link, tap "Yes, I'm attending"; host sees confirmed-vs-unconfirmed and chases the unconfirmed.
- **BrokerBay** (the TRREB/GTA incumbent — note: agent-to-agent *sales* showings, not consumer rentals): confirmation is a first-class, **per-listing setting** with three modes — **Auto-Confirm / Listing-Agent-Confirms / Seller-or-Tenant-Confirms**; notifications go by **email, SMS, or both**; and critically the **accept / deny / cancel / suggest-new-time actions are embedded right in the SMS or email** (no portal visit). Every state change alerts in real time; automated post-showing feedback.
- Takeaway: a passive reminder becomes an **active commitment** + gives the operator an at-risk signal. **Put the action inside the message** (BrokerBay). Make confirmation a **configurable mode** (BrokerBay). But note BrokerBay documents **no pre-showing reminder cadence and no response deadline** — because for agents a no-show is a reputation matter. For **consumer renters** (our demand-side problem), the near-time reminder + attendee confirmation is exactly the gap the incumbent leaves open → this is where Vacantless differentiates.

## 2. Where Vacantless is today
- Reminders: reliable **24h** (email + optional parallel SMS), an unreliable **~2h** (free GH-Actions pinger misses the narrow window — fired 1/6 recent showings), firing **email + SMS at the same tier** = double-ping for SMS orgs.
- Confirmation plumbing EXISTS (`showings.confirmed_at`/`confirmed_by`/`cancel_token`/`outcome_token`/`confirmation_nudge_sent_at`, `showing-confirmation-nudge` cron) — **but the nudge emails the assigned AGENT to confirm, not the renter.** Missing the renter-facing confirm ask that ShowMojo, Calendly, and BrokerBay all center on.
- `renter_sms` is a **Growth** entitlement (Agile has it); SMS backend armed but dark pending QUO A2P (~Jul 22–24).

## 3. Recommended strategy (the target state)

**Cadence — two coordinated touches, SMS for urgency, action in the message:**

| When | Channel (SMS org) | Channel (no SMS / undeliverable) | Content |
|---|---|---|---|
| On booking | Email | Email | Confirmation + address/map + reschedule/cancel *(exists)* |
| **T-24h** | **Email** | Email | Reminder + reschedule window + **one-tap Confirm** |
| **T-~4h (day-of)** | **SMS** | **Email (fallback)** | Short, urgent: "You're on for {time} at {addr}." + **one-tap Confirm** / reschedule |
| T-2h (optional) | SMS (default OFF) | — | Last-minute, tunable |
| Post-showing | Email | Email | Outcome/feedback *(exists)* |

Rules: **never both channels at the same tier**; **email is always the fallback** (no dropped day-of touch); offsets tunable (3–4h day-of sweet spot); **the Confirm/reschedule/cancel action lives inside the reminder** (BrokerBay), link-based so it works before inbound SMS exists.

**Two-step build:**
- **S520 (build now):** reliable day-of tier (~T-4h, wide band) + **channel coordination** (email day-ahead, SMS day-of, email fallback, no double-ping) + **one-tap renter Confirm embedded in the reminder** (token route stamping `confirmed_at`/`confirmed_by='renter'`). Complete renter-facing intervention; delivers value via email now, SMS when QUO lights up. Stays Growth+ (no takeaway). *(ticket: `claude/CODEX-BUILD-SAMEDAY-REMINDER-S520.md`)*
- **S521 (next):** the **operator confirmation layer** — BrokerBay's three modes as a per-org/property setting (auto / operator / renter-confirms), an **unconfirmed = at-risk** operator surface (repurpose the agent `showing-confirmation-nudge`), and opt-in **auto-release/flag** of unconfirmed slots. The bigger operator win + the natural **Premium up-sell**, layered ON TOP of the Growth baseline (never gating the basics away from Agile).

## 4. Why not more/other
- >2–3 touches: diminishing returns (RCT) + over-texting risk.
- 30-min final touch (Calendly default): too late to recover a landlord slot, too tight for the pinger — 3–4h fits leasing.
- Voice/IVR: last-resort in the literature; out of scope for the leasing wedge.

**Sources:** AJMC randomized trial (number/timing of reminders); Calendly no-show guide + reconfirm-meetings workflow; ShowMojo release notes; BrokerBay seller features + "navigating as a seller" (confirmation modes, in-message actions); Vital Interaction (email vs text vs voice).
