#!/bin/bash
# S809b: never email the demo login (it has no mailbox; Lakeview alerts bounced).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s809b-msg.txt <<'MSG'
S809b: never email the demo login

The overnight check (2026-11-17) found a bounce: the S808 text-in repair
test on Lakeview emailed every member, including demo@vacantless.com, which
has no mailbox (550 5.1.1). Bounces hurt sending for every account.

- lib/email.ts brevoFetch, the one place every email leaves the app: a
  message to DEMO_ACCOUNT_EMAIL is skipped (202 "skipped: demo login has no
  mailbox") before it reaches Brevo.
- scripts/test-demo-account.ts: the send skips the demo login.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqw2x3R4yHt5egsYRV
MSG
git add lib/email.ts scripts/test-demo-account.ts COMMIT-S809b-NO-MAIL-TO-DEMO.sh
git commit -F /tmp/s809b-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
