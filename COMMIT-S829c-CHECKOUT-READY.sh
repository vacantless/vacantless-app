#!/bin/bash
# S829c: email when a paid ad is ready to pay; approve fix for built Kijiji checkouts.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'checkoutReadyAction' app/api/cron/checkout-ready/route.ts || { echo "STOP: S829c edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s829c-checkout-ready.ts
npx tsx scripts/test-s829-approve-release.ts
node scripts/run-all-tests.mjs
git add lib/checkout-ready.ts lib/approve-release.ts app/api/cron/checkout-ready/route.ts lib/cron-sweeps.ts .github/workflows/reminders.yml lib/message-catalog.ts "app/dashboard/properties/[id]/publish-everywhere.tsx" supabase/migrations/0319_checkout_ready_email.sql scripts/test-s829c-checkout-ready.ts scripts/test-s829-approve-release.ts COMMIT-S829c-CHECKOUT-READY.sh
git commit -m "S829c: email the landlord when a paid ad is ready to pay

Noam (2026-11-22): people approve and walk away before checking out, and
nothing told them a Kijiji ad was waiting at checkout. Now the 15-minute
sweep (app/api/cron/checkout-ready, lib/checkout-ready) emails the owners
once when the robot leaves a paid ad at checkout, and once more 4 hours
later if it is still unpaid; both stamps (0319) clear when the ad leaves
checkout. Agile is skipped, as for the is-live email. The approve dialog
says a paid site is ready about 5 minutes after approval.

Also fixes S829a: a built Kijiji checkout is p-post-ad.html?addToCart=true
(S709), which S829a treated as a bare form; approving it would have sent
the ad back to the robot. 'Built' is now exactly siteCheckoutUrl.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
