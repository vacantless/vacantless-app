#!/bin/bash
# S836a: the monthly report retries a send that reached nobody
# (REVIEW-S835 finding 11). No migration.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
test -f scripts/test-s836a-report-retry.ts || { echo "STOP: scripts/test-s836a-report-retry.ts missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s836a-report-retry.ts
npx tsx scripts/test-s831-rental-report.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add app/api/cron/rental-report/route.ts lib/rental-report.ts \
  scripts/test-s836a-report-retry.ts COMMIT-S836a-REPORT-RETRY.sh
git --no-pager diff --cached --name-only
git commit -m "S836a: the monthly report retries a send that reached nobody

REVIEW-S835 finding 11: the month was claimed before the email went out,
and a failed send was neither logged nor retried, so a report that
failed on Dec 1 would be skipped for the month without a word.

- The claim still comes first, so two runners never both send.
- If nobody got the email, the month is handed back (only if the claim
  is still ours) and the next 15-minute sweep on the 1st tries again.
- If some recipients got it, the claim stays so nobody gets it twice.
- Either way the sweep answers ok:false with the rental and the send
  reason, so the health email and the two-in-a-row alert show it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqyiS529vGUCbVcrNq"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
