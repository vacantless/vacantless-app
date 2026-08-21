# RUNBOOK — Kijiji paid lane, PHASE-1 recon ($0) — S651

**Goal:** run the new paid lane against Agile's real Kijiji at **$0**, to harvest the plan-wall facts (base package code, base price, the "Total Price" text with tax). No payment is possible in this run.

**State already set for you (by Cowork, verified 2026-08-13 17:00 UTC):**
- Agile Kijiji `automation_authorized = true`; warmed session ~1.5h old (fresh).
- Unit 3 item `404542f9` is APPROVED + unclaimed + fresh-post (backup null, last_attempt null). The box will claim it.
- Branch `codex/s651-kijiji-paid-lane` is on your Mac, uncommitted. The box still runs old `main` (no paid lane), so you must rsync the branch to the box first.

**Why this run cannot charge (4 independent blocks):** `WORKER_PAY_MAX_CENTS=0` (any price > 0 -> over_ceiling), `savedMethodNames` is still the placeholder (matches no button), `basePackageCode` is empty (explicit no-pay guard), and the total-vs-base assertion will stop at the plan wall before checkout. Expect it to stop at the plan wall, not reach the checkout page. That is correct for phase 1.

---

## STEP 0 — (your Mac) push the branch to the box
```bash
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-worker"
rsync -av --exclude '.git' --exclude 'node_modules' --exclude '.env' --exclude 'artifacts' \
  ./ worker@62.238.44.133:/opt/vacantless-worker/
```
No `npm install` needed (no new deps; only new source files + scripts).

## STEP 1 — (box) stop the timer so it can't grab the item first
```bash
ssh worker@62.238.44.133
sudo systemctl stop vacantless-worker.timer
cd /opt/vacantless-worker
grep -E 'TARGET_ORG_ID|ALLOW_AGILE_PROD|WORKER_ENABLED|TARGET_CHANNEL' .env
```
Confirm: `TARGET_ORG_ID` = the Agile UUID, `ALLOW_AGILE_PROD=true`, `WORKER_ENABLED=true`. (`TARGET_CHANNEL` can be kijiji or unset; the command below pins it anyway.)

## STEP 2 — (box) run the phase-1 paid recon ($0), capture output
```bash
TARGET_CHANNEL=kijiji WORKER_PAY_MAX_CENTS=0 npm run submit:b:live:pay 2>&1 | tee /tmp/s651-recon1.json
```

## STEP 3 — send the results back to me
Paste back:
1. The tail JSON from `/tmp/s651-recon1.json` (the `paid_*` fields + `paid_plan_debug`: scraped plans, package codes, prices, and the Total text).
2. If you want the visuals: `ls -t /opt/vacantless-worker/artifacts/phase-b-submit-paid-*.png | head` and scp the newest one over.

Then I turn the real numbers into the Codex follow-up (tax-tolerant assertion + the confirmed `basePackageCode`), and phase 2 re-runs to reach the checkout page and capture the saved-method button names, still at $0.

---

### Notes
- **If STEP 2 reports `needs_login`** (session went stale): re-warm on your Mac, then re-run STEP 2:
  ```bash
  cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-worker"
  TARGET_ORG_ID=<AGILE_UUID> TARGET_CHANNEL=kijiji npm run warm
  # sign into Agile's Kijiji by hand in the browser it opens, then rsync (STEP 0) is not needed again
  ```
- **Re-running:** the initial Post click consumes the approval, so after this run the item is spent. If you need to run again, tell me and I'll re-approve item `404542f9` in one command.
- **When done:** leave the timer stopped until we finish the recon cycle, or `sudo systemctl start vacantless-worker.timer` to resume normal operation (harmless on Agile: free lane fail-safes, no email/execute).
- The box .env `.env.bak-s650` backup from S650 still exists if you need to revert the Agile repoint.
