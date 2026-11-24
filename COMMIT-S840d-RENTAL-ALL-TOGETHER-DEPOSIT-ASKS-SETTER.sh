#!/bin/bash
# S840d: the rental page's other two slow steps start their questions together
# (timing log removed); a deposit reminder also goes to whoever set the deposit
# stage; crew email subjects say "1 unit", not "1 units".
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "const liveFactsEarly = early(" "app/dashboard/properties/[id]/page.tsx" || { echo "STOP: S840d rental edit missing"; exit 1; }
grep -q "u.stageById === c.id" lib/unit-progress-reminders.ts || { echo "STOP: S840d deposit edit missing"; exit 1; }
if grep -q "s840-rental-timing" "app/dashboard/properties/[id]/page.tsx"; then echo "STOP: timing log still in"; exit 1; fi
npx tsc --noEmit -p .
npx tsx scripts/test-s839c-early-request-cache.ts
npx tsx scripts/test-unit-progress-reminders.ts
node scripts/run-all-tests.mjs
git add "app/dashboard/properties/[id]/page.tsx" \
  lib/unit-progress-reminders.ts lib/unit-progress-notify.ts lib/unit-progress-server.ts lib/notifications.ts \
  scripts/test-unit-progress-reminders.ts scripts/test-s840b-renters-paging.ts \
  scripts/test-site-row-facts.ts scripts/test-rentals-slots.ts \
  COMMIT-S840d-RENTAL-ALL-TOGETHER-DEPOSIT-ASKS-SETTER.sh
git --no-pager diff --cached --name-only
git commit -m "S840d: rental page questions together; deposit reminder asks the stage setter

REVIEW-S839 step H, and Noam's yes on 2026-11-24.
- Rental page: after S840c, the assets/documents/marketing step (+250 to
  300 ms) and the sites step (+300 to 500 ms) still asked one question at a
  time. 13 more questions now start early(), each chained only on the early
  answer it needs (appliances -> consumables and receipts, role -> documents
  -> share links, posts -> reserved drafts, runs -> live facts, active run ->
  run items). No filter or logic changed. The S840b timing log is removed.
  Two source-text tests follow the moved queries.
- Crew reminders: a unit waiting on a deposit (or a clearing one) also asks
  the crew member who set that stage, when that is not the leasing person
  (Unit 9: Narayan set it, only Aaliyah was asked). The landlord's stuck note
  names everyone asked once.
- Subjects: \"No update from your crew on 1 unit\" and \"<org>: 1 unit to
  update\" (the Nov 24 email said \"1 units\").

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMLwSHQkDAVv4gVne"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
