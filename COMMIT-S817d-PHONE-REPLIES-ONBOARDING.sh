#!/bin/bash
# S817d: onboarding step "Answer renters from your phone", a welcome email line, and a Sites row line. Run after S817c.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-onboarding-wizard.ts
npx tsx scripts/test-onboarding-emails.ts
npx tsx scripts/test-sites-setup.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/onboarding-wizard.ts lib/reply-kit-server.ts lib/onboarding-emails.ts lib/sites-setup.ts \
  "app/dashboard/(wizard)/getting-started/page.tsx" app/dashboard/page.tsx app/dashboard/replies/send-shortcut-card.tsx \
  scripts/test-onboarding-wizard.ts COMMIT-S817d-PHONE-REPLIES-ONBOARDING.sh
git commit -m "S817d: Answer renters from your phone, in onboarding

Quick replies and Send to Vacantless were only reachable from the menu, while
the Chrome helper was in the steps, the welcome email and the Sites page.
Marketplace renters write in Messenger, mostly on a phone, the one channel
that does not come in by itself. New Getting started step after See it work,
done on the first renter saved from the phone (Shortcut or Quick replies
Copy note); one welcome email line; the Marketplace row says replies happen
on the phone; the Shortcut card opens by itself until a key is made.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqHBdFvs17yuYwWkhZ"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
