#!/bin/bash
# S833c: the price on the chat's ad line checks the AI's rental pick (iPhone Shortcut and Android share).
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S833c" lib/ai-enquiry.ts || { echo "STOP: S833c edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-ai-screenshot-lead.ts
node scripts/run-all-tests.mjs
git add lib/ai-enquiry.ts lib/ai-screenshot-lead.ts scripts/test-ai-screenshot-lead.ts COMMIT-S833c-PRICE-CHECKS-RENTAL-PICK.sh
git --no-pager diff --cached --name-only
git commit -m "S833c: the ad line's price checks the screenshot reader's rental pick

The same Marketplace chat (Kym, \$1,225) was read as Unit 33, no rental,
then Unit 3 (\$1,250). The reader now also returns price_shown; code keeps
the AI pick only when its rent matches, otherwise uses the one rental at
that price, or none when two share it. No price shown: the pick stands.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqDvRRhrhYkyT9VAYj"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
