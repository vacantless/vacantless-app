#!/bin/bash
# S745b: viewing helper = showing agent. No migration.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-viewing-helper-path.ts
npx tsx scripts/test-team-invites.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/team.ts app/dashboard/settings/team-section.tsx app/dashboard/showing-agents/page.tsx \
  scripts/test-viewing-helper-path.ts \
  COMMIT-S745b-VIEWING-HELPER.sh COMMIT-S745b-MESSAGE.txt
git commit -F COMMIT-S745b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
