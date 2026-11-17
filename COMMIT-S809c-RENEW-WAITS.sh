#!/bin/bash
# S809c: the renew reminder waits for Facebook's own "Renew (N days)" (helper 1.2.6).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s809c-msg.txt <<'MSG'
S809c: the renew reminder waits for Facebook's own Renew clock

2026-11-17: the reminder asked Noam to renew Pillette Unit 3 on
Marketplace while Facebook showed "Renew (7 days)" on all four Agile ads
(Unit 3's renewal the day before never reached Vacantless).

- Helper 1.2.6 reads Facebook's greyed "Renew (N days)" off an ad's menu
  and hands it to the next Vacantless page (get_renew_waits /
  renew_waits_saved, same channel as renewals).
- lib/marketplace-helper: cleanRenewWaits and renewWaitPostedOn. The live
  ad's posted date moves so the 9-day Facebook rule lands on the day
  Facebook opens Renew; never backwards, never past the day it was seen.
  Every screen and email that ages ads agrees without other changes.
- lib/marketplace-helper-server saveHelperRenewWaits, the
  helperSaveRenewWaits action, the dashboard sync and layout wiring.
- scripts/test-helper-renew-wait.ts (21 checks, Unit 3 case: due
  2026-11-24); test-chat-leads accepts a helper newer than 1.2.5.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqw2x3R4yHt5egsYRV
MSG
git add app/dashboard/layout.tsx app/dashboard/marketplace-helper-actions.ts components/marketplace-helper-sync.tsx lib/marketplace-helper-server.ts lib/marketplace-helper.ts scripts/test-chat-leads.ts scripts/test-helper-renew-wait.ts COMMIT-S809c-RENEW-WAITS.sh
git commit -F /tmp/s809c-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
