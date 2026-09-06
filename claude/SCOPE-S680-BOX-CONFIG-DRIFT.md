# SCOPE S680 - the box/repo config drift, and the alert path that cannot alert

Session 680, 2026-09-04. Everything here comes from the two read-only captures taken at
13:58Z and 14:01Z. Five items, ranked. **Item 2 is the one with a live consequence.**

---

## ITEM 1 - the three box-only systemd configs are not in git [DONE 2026-09-04, commit `4ff6a5e`, local only]

**The trap.** `bootstrap-vps.sh:79-80` installs the units **from the repo**. The running
box carries three configurations the repo has never seen:

| what | where | created |
|---|---|---|
| `Environment=WORKER_RUN_MODE=submit:b:dark` | `…/vacantless-worker.service.d/10-run-mode.conf` | 2026-08-28 14:02 |
| `TimeoutStartSec=900` | `…/vacantless-worker.service.d/timeout.conf` | 2026-08-13 01:58 |
| `Environment=HOME=/home/worker` | hand-added to the deployed unit | 2026-07-23 21:14 |

So a re-provision drops all three and **the box comes back in
`submit:b:live:free` - LIVE, not dark**, because that is `run-once.sh:32`'s default. The
consequence is not a broken box; it is an armed one, silently.

**The fix.** `APPLY-S680-BOX-CONFIG-INTO-REPO.sh` (project folder root). It copies the
files out of the capture backup **verbatim** rather than transcribing them from a report,
so what lands in git is byte-identical to what is running, and it teaches
`bootstrap-vps.sh` to install the drop-in directory.

Gates, all of which abort before touching anything:

- **G0** a `*-units` capture exists under `~/vacantless-box-backup/`
- **G1** the worker repo is present and the working tree is **clean**
- **G2** the deployed unit differs from the repo unit by **exactly one** added line and
  that line is `Environment=HOME=/home/worker` - any other difference aborts
- **G3** `dropins.tar` contains exactly `10-run-mode.conf` and `timeout.conf`, and the
  first one really sets `submit:b:dark`
- **P1** `bash -n` on the patched bootstrap
- **P2** `git check-ignore -v` on both new paths - a gitignored file would never reach
  the repo, so this fails loudly instead of quietly succeeding
- **P3** re-diffs all three files repo-vs-box and requires identical
- **P4** the new install lines are actually present in bootstrap

Idempotent (a second run says ALREADY APPLIED and exits 0), reversible (`.bak-pre-s680`
for every edited file, and a printed `git checkout --` revert), and it **does not
commit** - it prints the commit command and stops. It never touches the box.

The awk insertion was dry-run against a copy of `bootstrap-vps.sh` this session: parses
clean, +8 lines, inserted immediately before `systemctl daemon-reload`.

**Design note worth keeping.** The drop-in overrides the *service* environment only, so a
by-hand `run-once.sh` still defaults to `submit:b:live:free` - which is exactly what
`HOST-RUNBOOK.md` sections 5 and 6 rely on for the dark and live-free proofs. Those steps
keep working unchanged. What changes is that **the unattended timer ships dark and arming
it live becomes a deliberate act** (remove or edit the drop-in, then `daemon-reload`) -
a third kill switch alongside `WORKER_ENABLED` and the timer itself.

**APPLIED AND COMMITTED 2026-09-04 14:09Z.** All four gates and all four proofs passed
on the live run; read back off disk afterwards. Worker `main` is now **`4ff6a5e`**,
4 files / 13 insertions, working tree clean. **NOT PUSHED** - `origin/main` is still
`8efb93b` and local main is two ahead (`89ef02c` then `4ff6a5e`). The push is a separate
decision and belongs next to PR #9, because it would carry `89ef02c` with it.

**A stale `.git/index.lock` blocked the first commit attempt** - zero bytes, dated
**2026-08-29 13:03**, six days old, no live git process. Parked at
`_to_delete/git-stale-locks-s680/` per this project's existing convention (six prior
parkings), not deleted. **Implication worth carrying: every git WRITE in the worker repo
had been failing since 2026-08-29** - the same day as the last `concierge/agent` attempt
row, so probably the same interrupted session. Reads were unaffected, which is why
nothing surfaced it for six days. It may also mean `89ef02c` sat unpushed because the
write failed rather than because anyone decided to hold it - **do not silently
reinterpret the "do not touch 89ef02c" note on that basis, but weigh it at the push.**

**Follow-on, not in the script:** `HOST-RUNBOOK.md` section 7 ("Arm the timer") and
section 10 ("Kill switches") both need a line about the drop-in. Section 10 currently
says "two independent ways to stop everything"; after this it is three.

## ITEM 2 - THE BOX CANNOT ALERT. The recurring-chore design is broken today.

**`BREVO_API_KEY` and `ALERT_EMAIL_TO` are ABSENT from `/opt/vacantless-worker/.env`**
[read 2026-09-04 13:58Z]. `run-once.sh:50-53` no-ops `send_alert` when either is unset
and just logs `alert NOT sent`.

That falsifies two documented behaviours:

- **Runbook section 9**, "the one recurring chore": a tick hits the login wall, flips
  `account_status` to `needs_login`, **and emails you**. It does not. The session can die
  and nothing tells anyone.
- **`vacantless-alert-heartbeat.timer`** is enabled and active and last fired
  2026-09-01 03:00:29Z with `Result=success` - a monthly self-test that **sent nothing**.
  The dead-man's check on alerting is itself dead, and it reports success while dead.

**Fix:** add `BREVO_API_KEY` (reuse the app's - the runbook says no new account or domain
verification is needed) and `ALERT_EMAIL_TO` to the box `.env`, then confirm with
`sudo -u worker /opt/vacantless-worker/deploy/run-once.sh selftest`, which sends one test
email and runs no tick. **This is a box-side edit, so it needs a Terminal paste and it is
Noam's to run.** Not scripted here because it writes to the box and touches a secret.

**Ranked above item 1** because item 1 is a latent trap that fires only on a
re-provision, while item 2 is false today and is the mechanism by which a dead session
would go unnoticed.

## ITEM 3 - `bootstrap-vps.sh` does not install the alert-heartbeat units

They exist in `deploy/systemd/` and are **enabled and active on the box**, so they were
installed by hand. Same drift class as item 1. Deliberately **excluded** from the item 1
script to keep that change to "capture what is running, change no behaviour" - and
because it is pointless until item 2 gives it an API key. Do item 2, then fold these in.

## ITEM 4 - `vacantless-takedown.timer` reads `not-found` on the box

The units are in the repo; they were never installed here. **Open question, not a
defect:** was that deliberate? Do not add it to bootstrap by reflex - installing a
takedown timer on a fresh box arms a delete path, and per the standing rule that is not
something to switch on as a side effect of a config-drift cleanup.

## ITEM 5 - the box `.env` is `-rw-r--r--`, not the `600` the runbook prescribes

Single-tenant box, one admin, so the exposure is small. Worth a `chmod 600` next time
someone is on the box anyway; not worth a paste of its own.

---

## Not proposed

- Changing `run-once.sh`'s own default from `submit:b:live:free`. It would break the
  runbook's by-hand live-free proof, and the drop-in already solves the unattended case.
- Anything that touches the box. Every item above except 2 and 5 is a local repo change.
- Granting the spend ceiling. Settled separately in
  `FINDINGS-S680-WHAT-THE-BOX-ENV-ACTUALLY-DECIDES.md` - six barriers, safe to grant.

[[project_agile_leasing_engine]] [[project_kijiji_lane_real_gate]]
