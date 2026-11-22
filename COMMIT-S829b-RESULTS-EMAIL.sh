#!/bin/bash
# S829b: the "is live" email, shorter and without repeats.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
rm -f zz-preview.ts
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'viewingsByRequest' lib/posted-results-email.ts || { echo "STOP: S829b edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-posted-results-email.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/posted-results-email.ts app/api/cron/posted-results-email/route.ts scripts/test-posted-results-email.ts COMMIT-S829b-RESULTS-EMAIL.sh
git commit -m "S829b: the is-live email, shorter and without repeats

Noam read the 251 Manitoba email (2026-11-22): it said live on 2 sites
for one rental site (the Vacantless page was counted), printed the page
link twice and the rental link three times, said booking link twice, and
told a landlord who books each viewing himself that renters pick a time.
Now: the subject names the site (or counts rental sites only) with the
short address; the page link appears once; the viewing line follows
organizations.viewings_by_request; the next step rides the button
(Post to Marketplace) instead of a raw link in the body.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGorzZRkyX89r57Su5V"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
