#!/bin/bash
# S811a: REVIEW-S805 findings 10 and 11 (sign-in window wording, Zumper first).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s811a-msg.txt <<'MSG'
S811a: sign-in window without the password line; Zumper first when new

REVIEW-S805 finding 10. A live Zumper window on Agile (2026-11-17) opened
straight onto Zumper's login: the one-time password rides in the link, so
the window never asks for it. The page no longer shows the password or the
"web address looks unusual" warning; it says "This opens <site> inside a
Vacantless window." The window was stopped unsigned; Agile's Zumper sign-in
stayed as it was.

REVIEW-S805 finding 11. A Zumper that was never signed in now leads the
robot sites on Connect your rental sites: "Do this one today: Zumper checks
your ID, which can take a day." with a note to make the account and send the
ID on Zumper. An ended Zumper sign-in keeps its place (ID already checked).

- app/dashboard/site-signin/[channel]/window-panel.tsx
- lib/sites-setup.ts
- scripts/test-sites-setup.ts (order, line, two new checks)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGmw1c6vqZpyKyDxRGy
MSG
git add "app/dashboard/site-signin/[channel]/window-panel.tsx" lib/sites-setup.ts scripts/test-sites-setup.ts COMMIT-S811a-SIGNIN-WINDOW-ZUMPER-FIRST.sh
git commit -F /tmp/s811a-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
