# DECISION S680 - the Hetzner box: TOP UP. Do not let it lapse.

Session 680, 2026-09-04. Balance about $6 [Noam; not verifiable from any session
surface]. **Written before the box was read, then rewritten after** - the read
strengthened the recommendation and changed the reason for it. Nothing spent by Cowork.

## The recommendation

**Top up, and revisit on 2026-10-04 alongside the Kijiji ad renewal.**

The pre-read version of this doc said "top up, but not because the box is useful - it is
provably doing nothing." **The read corrected that.** The box is not idle infrastructure.
It is a healthy, correctly-configured, deliberately-darkened executor with 42 days of
uptime, 277 successful ticks a day, and **three hand-made configurations that exist
nowhere except on that disk**:

| what | where | created |
|---|---|---|
| `WORKER_RUN_MODE=submit:b:dark` | `…/vacantless-worker.service.d/10-run-mode.conf` | 2026-08-28 |
| `TimeoutStartSec=900` | `…/vacantless-worker.service.d/timeout.conf` | 2026-08-13 |
| `Environment=HOME=/home/worker` | hand-added to the deployed unit | 2026-07-23 |

None of the three is in git. `bootstrap-vps.sh` installs units **from the repo**, so a
re-provision does not merely cost time - **it returns a box running
`submit:b:live:free`, live rather than dark**, unless someone remembers to restore the
drop-ins by hand.

**That is the real cost of lapsing, and it is a safety cost, not a money cost.** It is
now mitigated (both the `.env` and the drop-ins are backed up under
`~/vacantless-box-backup/`), but a restore-from-backup step you have to remember is worse
than a box you did not destroy.

## The rest of the arithmetic, unchanged

- **Keeping it:** a month of hosting. Trivial next to an hour of Noam's time. (Confirm
  the monthly rate in the Hetzner console; not verifiable from here.)
- **Losing it:** `HOST-RUNBOOK.md` sections 0-7 - new server, `bootstrap-vps.sh`,
  hand-build `.env`, dark proof, live-free proof, arm the timer. One to two hours, plus a
  **new box IP**, which means revisiting the Supabase network-restriction allowlist
  (the runbook names that failure as `HTTP 000` in section 3), plus restoring the three
  drop-ins above.
- **Updating a live box once the payment-prompt lane exists is an `rsync` and a
  restart** - minutes. Rebuilding from nothing is the expensive path, and lapsing buys it.

## What the box is NOT doing, stated honestly

Its ticks all read `claimed: 0, skippedReason: "no_approved_job"`, and that is correct
behaviour, not a fault:

- **Zero** kijiji run items are sitting approved, in any org, so there is nothing to claim.
- Since the 2026-09-03 backfill both kijiji rows are
  `requires_payment=true, spend_authorized=false`, so a claim would be refused anyway.
- It is pointed at **Growth Test**, not Agile, and runs **dark**.

So it produces no business value today. The case for keeping it is the cost of losing it,
not the value of running it - and after the read, that cost is higher than it looked.

## Why 2026-10-04 is the right revisit date

Both Kijiji ads expire that day; renewal is a **$67.68** decision. The standing plan for
Kijiji is "revisit after the first paid month, be willing to take option D (drop it)". If
Kijiji is dropped the box has no remaining job - `TARGET_CHANNEL=kijiji` [verified on the
box], and `vacantless-takedown.timer` reads **not-found**, i.e. the takedown lane was
never installed here. Deciding both on one date lets Unit 3's `?p=` attribution - the
first honest per-ad number this system has produced - answer the question instead of a
guess.

## What would flip this to "let it lapse"

1. Noam drops Kijiji on 2026-10-04.
2. The payment-prompt lane is shelved rather than built.

The pre-read flip condition "the capture shows the box is already dead" is **retired**:
it is emphatically alive.

## What this does NOT decide

Nothing about arming anything. Topping up a balance is not consent. Separately, the spend
ceiling **can** now be granted - see
`FINDINGS-S680-WHAT-THE-BOX-ENV-ACTUALLY-DECIDES.md`, which finds six independent
barriers between that grant and any unattended Agile action.

[[project_agile_leasing_engine]] [[project_kijiji_lane_real_gate]] [[project_kijiji_channel_decision]]
