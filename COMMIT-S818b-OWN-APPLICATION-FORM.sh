#!/bin/bash
# S818b: an account's own application form (Buildium and the like), and "?" help matched on five more pages.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s818b-own-application-form.ts
npx tsx scripts/test-page-help.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/org.ts lib/rental-application-server.ts lib/page-help.ts \
  "app/agent/[token]/actions.ts" "app/dashboard/leads/[id]/application-card.tsx" "app/dashboard/leads/[id]/page.tsx" \
  app/dashboard/leads/actions.ts app/dashboard/settings/actions.ts app/dashboard/settings/page.tsx app/page.tsx \
  supabase/migrations/0309_org_application_link.sql scripts/test-s818b-own-application-form.ts scripts/test-page-help.ts \
  COMMIT-S818b-OWN-APPLICATION-FORM.sh
git commit -m "S818b: send your own application form (Buildium), help videos on 5 more pages

Agile takes applications in Buildium, so a Vacantless application was a
second system, and renters were promised a Buildium form that never came.
An account can now paste its own application link (Settings, Brand tab).
Send application, from the renter page or the showing agent's link, then
emails that form with the rental's address and notes it on the renter; no
Vacantless application row is made (0309, already applied). The \"?\" help
now opens a matching video on People, Phone book, Crew, Settings and Me.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGokzebAsp6GCX7VNvL"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
