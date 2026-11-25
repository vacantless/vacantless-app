#!/bin/bash
# S841g: emailed Rentals.ca codes go into the open window; the next site's
# window starts early; the health email skips a sign-out with nothing waiting;
# the /warm ping and boot marks come out (measured, they did not help).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "export function siteSigninCode" lib/site-mail-pass.ts || { echo "STOP: S841g code edit missing"; exit 1; }
grep -q "prestartSiteSignin(nextChannel)" "app/dashboard/site-signin/[channel]/window-panel.tsx" || { echo "STOP: S841g panel edit missing"; exit 1; }
if grep -q '"/warm"' vercel.json; then echo "STOP: /warm cron still in vercel.json"; exit 1; fi
git rm -q --ignore-unmatch lib/boot-mark.ts app/warm/page.tsx
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s841g-code-early-window.ts
npx tsx scripts/test-s841c-keep-warm.ts
node scripts/run-all-tests.mjs
git add lib/site-mail-pass.ts lib/site-mail-pass-server.ts \
  "app/dashboard/site-signin/[channel]/actions.ts" "app/dashboard/site-signin/[channel]/window-panel.tsx" \
  app/api/cron/health-digest/route.ts app/dashboard/layout.tsx app/robots.ts lib/canonical-host.ts vercel.json \
  scripts/test-s841g-code-early-window.ts scripts/test-s841c-keep-warm.ts scripts/test-canonical-host.ts \
  scripts/test-s839-photo-size.ts COMMIT-S841g-CODE-EARLY-WINDOW-WARM-OFF.sh
git --no-pager diff --cached --name-only
git commit -m "S841g: emailed sign-in codes typed for you; next window starts early; /warm out

- Rentals.ca's Login Verification email (read 2026-11-25) lands at the
  Vacantless address for accounts made with Make my account. Its six-digit
  code now goes into the landlord's open window, only when that window is
  showing the code box (detail enter_code), same account and site, under 30
  minutes old. The owners still get the copy, which says it was typed.
- In one sitting, the next site's window starts while the landlord is still
  in this one (a window takes 60 to 95 s to be ready). Stop here closes it.
  The hand-over countdown is 3 s.
- Health email: a signed-out site with nothing waiting (S841d) is no longer
  listed as a problem.
- /warm and the boot marks are removed. Measured overnight: first Today
  load 2.34 s with the copy and the database path kept warm (database
  answered the ping in 0.2 to 1.2 s), against 0.67 to 0.85 s after.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqaQEE8GeiwbwwdKXb"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
