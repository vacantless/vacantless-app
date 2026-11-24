#!/bin/bash
# S840e: save migration 0332 (applied 2026-11-24) and its test in the repo.
# A renter who writes again now keeps what they wrote on their record.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
test -f supabase/migrations/0332_returning_renter_keeps_message.sql || { echo "STOP: 0332 file missing"; exit 1; }
npx tsx scripts/test-s840e-returning-renter-message.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0332_returning_renter_keeps_message.sql scripts/test-s840e-returning-renter-message.ts \
  COMMIT-S840e-RETURNING-RENTER-MESSAGE.sh
git --no-pager diff --cached --name-only
git commit -m "S840e: 0332 a returning renter keeps what they wrote

On 2026-11-24 three Agile renters pressed \"Can't make these times?\" two or
three times each after the 8:00 reopen text. 0238 kept them on one record
with a \"Wrote again\" note but dropped their message and the times that
suit them. 0332 adds \"They wrote: <their note>\" to that note. Applied on
Noam's go and proven by a rolled-back call on Lakeview 100. Additive.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMLwSHQkDAVv4gVne"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
