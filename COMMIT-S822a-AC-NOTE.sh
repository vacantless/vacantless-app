#!/bin/bash
# S822a: an A/C note per rental, read by Quick replies' Air conditioning answer.
# Migration 0311 (properties.ac_notes) must be applied BEFORE this push.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s812-reply-answers.ts
npx tsx scripts/test-sister-unit-fill.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0311_property_ac_notes.sql "app/dashboard/properties/[id]/page.tsx" app/dashboard/properties/actions.ts lib/property-features.ts lib/reply-answers.ts lib/reply-kit-server.ts lib/sister-unit-fill.ts scripts/test-s812-reply-answers.ts COMMIT-S822a-AC-NOTE.sh
git commit -m "S822a: an air conditioning note per rental

Narayan confirmed Agile supplies no air conditioner at 833 Pillette and a
tenant's portable unit must fit the wall sleeve exactly (a smaller one
leaks). Quick replies could only say 'It does not come with air
conditioning.' A rental now holds a short A/C note, edited beside the A/C
choice; the Air conditioning answer adds it, and sister-unit fill copies
it. A note alone is never an answer (no-fake rule).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGokZ73XK4onn62KW9a"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
