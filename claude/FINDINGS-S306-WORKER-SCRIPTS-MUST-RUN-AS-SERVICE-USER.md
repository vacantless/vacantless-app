# FINDINGS S306: running a worker script over `ssh root@` looks like a missing browser

Written 2026-08-28 (Session 306). A self-inflicted failure, filed because the next person will hit it.

## What happened

`S306-PROOF-B-HANDOVER.sh` v1 ran:

```
ssh root@62.238.44.133 'cd /opt/vacantless-worker && npm run proof:b'
```

It claimed the run item and died:

```
browserType.launch: Executable doesn't exist at
/root/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell

Looks like Playwright was just installed or updated.
Please run the following command to download new browsers:
    npx playwright install
```

## Nothing was missing

The browser is at `/home/worker/.cache/ms-playwright/chromium_headless_shell-1228/...`, build `1228`, exactly what Playwright 1.61.1 wants. **The systemd unit declares `User=worker`.** Playwright resolves its browser cache from `$HOME`. Run as root, `$HOME` is `/root`, look in the wrong home, see no browser.

`node_modules/playwright-core` was last touched 2026-07-23 and `package-lock.json` 2026-07-22. Nothing was installed or updated that day.

## Two traps, both worth naming

**1. That banner is boilerplate, not evidence.** Playwright prints "Looks like Playwright was just installed or updated" whenever a browser is absent, whatever the cause. S306 read it as a recent-change signal and built a four-hour timeline around it that the file mtimes flatly contradicted. Check mtimes before believing a tool's guess about its own history.

**2. The reassuring inference was the dangerous one.** From "no browser under /root" S306 hypothesised the box had NEVER been able to browse, and therefore that months of `submit:b:live:free` arming had carried no real risk. That is false: the timer runs as `worker`, `worker` has the browser, the box could browse throughout. **The S305 de-arming was necessary.** An error in the reassuring direction is worse than one in the alarming direction, because nobody double-checks good news.

Our own memory already held the answer. `feedback_box_deploy_chown` has recorded `User=worker (uid 999)` since S647. Reading it first would have skipped both traps.

## The correct pattern

Derive the user from the unit, never assume, and set that user's HOME explicitly:

```bash
RUNUSER=$(systemctl show vacantless-worker.service -p User --value)
RUNHOME=$(getent passwd "$RUNUSER" | cut -d: -f6)
runuser -u "$RUNUSER" -- env HOME="$RUNHOME" npm run proof:b
```

`ssh root@` stays correct for READING files, systemd state and journals. It is wrong for executing worker code.

## The secondary lesson: check preconditions before side effects

v1 claimed the item first and discovered the problem second. That burned a claim and wrote a junk attempt (`75f9787a`, `reached_form=false`, `filled=0`) into the ledger, which then had to be explained. v2 adds a gate that locates `chrome-headless-shell` under the run user's home and **aborts before claiming anything**.

**A precondition that can be checked before a side effect must be checked before the side effect.** The v2 gates were then proven against every failure state, including a simulated root-HOME run, rather than only against the good path.

## Verified outcome

With v2, `proof:b` ran as `worker` at 18:42:03 UTC: `reached_form: true`, 20 fields filled, `challenge: none`, final URL `https://www.kijiji.ca/p-post-ad.html?categoryId=37`.
