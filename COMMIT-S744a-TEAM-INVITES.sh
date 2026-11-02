#!/bin/bash
# S744a: team invites. Migration 0265 must be applied first.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-team-invites.ts
npx tsx scripts/test-roles.ts
npx tsx scripts/test-selected-org.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add supabase/migrations/0265_team_invites.sql lib/team.ts lib/team-server.ts \
  lib/roles.ts lib/membership.ts lib/safe-next.ts lib/email.ts \
  app/dashboard/settings/team-actions.ts app/dashboard/settings/team-section.tsx \
  app/dashboard/settings/page.tsx components/settings-tabs.tsx \
  app/join/actions.ts "app/join/[token]/page.tsx" app/onboarding/page.tsx app/signup/page.tsx \
  scripts/test-team-invites.ts scripts/test-roles.ts scripts/test-plain-language.ts \
  COMMIT-S744a-TEAM-INVITES.sh COMMIT-S744a-MESSAGE.txt
git commit -F COMMIT-S744a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
