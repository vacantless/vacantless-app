#!/bin/bash
# S817a: Shortcut named "Send to Vacantless" (with spaces); sign-in window hardening and Rentals.ca log-in reply log (worker).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
mkdir -p public/shortcut
shortcuts sign --mode anyone --input shortcut-src/Send-to-Vacantless-unsigned.shortcut --output "public/shortcut/Send to Vacantless.shortcut"
ls -la public/shortcut
npx tsc --noEmit -p .
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add "public/shortcut/Send to Vacantless.shortcut" lib/send-shortcut-copy.ts scripts/test-s816l-send-shortcut.ts COMMIT-S817a-SHORTCUT-NAME-TRIAL.sh
git commit -m "S817a: the shared Shortcut is named Send to Vacantless

iPhone names an added Shortcut after its file, so it showed as
Send-to-Vacantless. The signed file now carries the spaces and Quick replies
links it; the hyphen file stays so a link already handed out still opens.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqHBdFvs17yuYwWkhZ"
git push origin main || git push origin main
echo "== app done"; git log --oneline -1

cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-worker"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-signin-window-logic.ts
npx tsx scripts/test-signup-prefill.ts
npx tsx scripts/test-rentals-account.ts
git add src/signin-window.ts src/signin-window-logic.ts scripts/test-signin-window-logic.ts .github/workflows/signin-window-trial.yml .github/workflows/signin-window.yml
git commit -m "S817a: sign-in window hardening and Rentals.ca log-in reply log

- apt-get update capped at 90 s with one retry in both sign-in window
  workflows (it hung in 2 of 4 S815 trial runs); install capped at 240 s.
- Sign-up mode waits 90 s between hint checks (was 15 s, so the check tab
  kept reopening while the landlord filled the form).
- Rentals.ca windows log the reply to the log-in request (status, host and
  path, a few headers, cleaned first 300 characters; never the request body)
  on GitHub and at home, to find what the log-in checks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqHBdFvs17yuYwWkhZ"
git push origin main || git push origin main
echo "== worker done"; git log --oneline -1
