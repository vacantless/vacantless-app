#!/bin/bash
# S821c: one helper seat on Free, so a family member or friend can set the account up with a newcomer.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-team-invites.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/team.ts scripts/test-team-invites.ts app/dashboard/settings/team-section.tsx app/page.tsx COMMIT-S821c-FREE-HELPER-SEAT.sh
git commit -m "S821c: one helper seat on the Free plan

A newcomer or a landlord who is not at ease with computers often has a
family member or friend do the setup. Free accounts had no teammate seat, so
that person had to share the owner's password. Free (and trial) now get one
seat; more seats stay on paid plans. The Getting started line that offers it
now shows on Free, the Team tab says when the one seat is in use, and the
homepage line says one on Free, more on paid plans. Noam's word 2026-11-19.

The homepage Quick replies line now says each reply is written for you in
clear English, for landlords who are not sure of their written English.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGnZ7VZEKhJ4sootXz7"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
