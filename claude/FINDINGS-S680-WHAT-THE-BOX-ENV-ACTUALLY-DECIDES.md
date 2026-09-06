# FINDINGS S680 - the box was read. It is ALIVE, it is in DARK MODE, and the dark mode exists only on the box

Session 680, 2026-09-04. Captured live at 13:58Z and 14:01Z from the box itself via
`capture-box-state-s680.sh` and `capture-box-unit-s680b.sh` (both read-only; nothing on
the box was changed). Standing rule 145 is now SATISFIED: the box has been read.

---

## THE HEADLINE: the box is healthy and has been working the whole time

| fact | value |
|---|---|
| uptime | **42 days** |
| ticks in last 24h | **277** |
| last tick | 2026-09-04 13:58:18Z, `Result=success`, `ExecMainStatus=0`, `NRestarts=0` |
| `vacantless-worker.timer` | **enabled + active**, next tick every 5 min |
| `vacantless-alert-heartbeat.timer` | enabled + active, last fired 2026-09-01 |
| `vacantless-takedown.timer` | **not-found** (never installed) |
| deployed sha | `8efb93b`, working tree **clean** |
| node | v22.23.1; disk 68G free of 75G |

Every tick reads `{"enabled": true, "ok": true, "mode": "dark", "claimed": 0,
"skippedReason": "no_approved_job"}` - the sub-second no-op the runbook describes.

**"No worker attempt row since 2026-08-29" was never evidence the box was down.** It was
awake the entire time, 277 times a day, with nothing to claim.

## THE CORRECTION: `submit:b:live:free` is the REPO default, not the BOX's mode

**S679 recorded, and S680 initially re-derived, that the timer defaults to
`submit:b:live:free`. That is true of the repository and FALSE of the running box.**

The box ticks in **`mode=submit:b:dark`**. The source is a systemd drop-in that exists
nowhere in git:

```
# /etc/systemd/system/vacantless-worker.service.d/10-run-mode.conf   (created 2026-08-28 14:02)
[Service]
Environment=WORKER_RUN_MODE=submit:b:dark
```

`systemctl show` confirms it is effective:
`Environment=HOME=/home/worker WORKER_RUN_MODE=submit:b:dark`.

The derivation that produced the wrong answer was sound about the repo and simply did not
ask the box: `run-once.sh:32` is `RUN_MODE="${WORKER_RUN_MODE:-submit:b:live:free}"`, it
takes only `selftest` as an argument, it never sources `.env`, the repo's unit sets no
`Environment=`, and `.env` carries no `WORKER_RUN_MODE`. All true. The override is one
directory the repo has never seen.

### THREE box-only modifications, none of them in git

| what | where | created |
|---|---|---|
| `Environment=WORKER_RUN_MODE=submit:b:dark` | `…/vacantless-worker.service.d/10-run-mode.conf` | 2026-08-28 14:02 |
| `TimeoutStartSec=900` | `…/vacantless-worker.service.d/timeout.conf` | 2026-08-13 01:58 |
| `Environment=HOME=/home/worker` | hand-added to the deployed unit itself | 2026-07-23 21:14 |

The third shows as the only line in `diff /opt/vacantless-worker/deploy/systemd/vacantless-worker.service
/etc/systemd/system/vacantless-worker.service`.

**`bootstrap-vps.sh` installs the units FROM THE REPO. A re-provision silently wipes all
three - and the box comes back in `submit:b:live:free`, live, not dark.** That is the
real perishable artifact on this box, more than the `.env`. Both are now backed up under
`~/vacantless-box-backup/` (outside the project folder).

**This is the standing-rule lesson: the deployed unit is not the repo unit.** Grepping
the repo tells you what a fresh box would do, never what this box is doing.

## The `.env`, read [2026-09-04 13:58Z]

Decision keys, verbatim:

```
WORKER_ENABLED       = true
TARGET_ORG_ID        = 8ea1da48-0cd2-45a4-bfba-023b31a67884     <- GROWTH TEST
TARGET_CHANNEL       = kijiji
HEADLESS_MODE        = new
KIJIJI_POST_URL      = https://www.kijiji.ca/p-post-ad.html?categoryId=37
ALLOW_AGILE_PROD     (key absent)
WORKER_PAY_ONFILE    (key absent)
WORKER_PAY_MAX_CENTS (key absent)
WORKER_RUN_MODE      (key absent)
```

Secrets present, values never read: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SESSION_ENC_KEY` (44 chars, consistent with a 32-byte base64 key), `PROXY_URL`, plus two
unrecorded keys - **`FB_PAGE_CHANNEL_ENABLED` and `FB_GRAPH_VERSION`**, which are not in
`deploy/env.host.example`. File is `-rw-r--r-- worker:worker`, mtime 2026-08-14 02:02:53Z.

**Note the permissions: 644, not the 600 the runbook prescribes.** Single-tenant box,
one admin, so the exposure is small, but it is a drift from the documented posture.

## THE SPEND VERDICT: granting Agile's ceiling is safe

There are **six** independent barriers between granting Agile kijiji `spend_authorized`
and any unattended Agile action, and the first two alone are decisive:

1. **`TARGET_ORG_ID` is Growth Test.** `claim.ts` filters every candidate query
   `.eq("organization_id", args.organizationId)` (`:148, :175, :275`). The box cannot see
   an Agile item at all.
2. **`ALLOW_AGILE_PROD` is absent.** `config.ts:75-82` hard-aborts if anyone repoints
   `TARGET_ORG_ID` at Agile prod without it.
3. **The box runs dark.** `WORKER_RUN_MODE=submit:b:dark` - it walks to the form and
   stops.
4. **`WORKER_PAY_ONFILE` is absent**, so the on-file payment path is off. (It would have
   worked from `.env` via `import "dotenv/config"` in `config.ts:7` if present - that was
   the one line worth checking, and it is not there.)
5. **The CVV wall.** No unattended worker can complete a Kijiji purchase.
   [[project_kijiji_fee_wall_cvv]]
6. **The app cron can never be the lane.** `route.ts:292` hardcodes
   `paymentCleared: false`.

**So the S679 hold can be released.** The consent barrier was doing its job, and the
thing it was guarding turns out to be pointed at the test org, in dark mode, with the
payment path off. Grant through Distribution settings - box ticked AND a positive ceiling
in the SAME save, or `settings/actions.ts:495` revokes. **A ceiling under 3384 cents
refuses a Lite ad.**

## Also verified this session [2026-09-04, Supabase]

- Both kijiji rows: `requires_payment=true, spend_authorized=false, spend_max_cents=null`,
  both `updated_at 2026-09-03 10:26:17.183621+00` (one backfill, not two edits). So the
  gate currently refuses **every** org, the box's own test org included.
- **Zero** kijiji run items sit approved (`operator_submit_approved_at` non-null, not
  live/failed/cancelled). Nothing to claim even with the gate open.
- Worker attempt lane is `transport=concierge, actor_type=agent`: 96 rows, last
  **2026-08-29 14:33:26Z**. The 2026-09-02 row is `automatic/operator` (app-side).
  `null/system` (2,042 rows) is the Vercel freshness cron.
- `operator_action_url`: **0 occurrences** in `vacantless-worker/`.
- PR #9 `70a2cf0` exists only on `codex/s674-attempt-error-code`; `origin/main` is
  `8efb93b`. Unmerged, confirmed.

## The gap this opened

**The box's three configurations should live in the repo**, so `bootstrap-vps.sh`
reproduces them instead of a redeploy silently arming a live worker. That is a small,
cheap change to `deploy/` and it is now the highest-value worker-side chore after PR #9.
Until it lands, **treat "re-provision the box" as an operation that requires restoring
the drop-ins by hand from `~/vacantless-box-backup/`.**

[[project_kijiji_lane_real_gate]] [[project_agile_leasing_engine]] [[project_kijiji_fee_wall_cvv]]
