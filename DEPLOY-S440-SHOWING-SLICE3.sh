#!/usr/bin/env bash
# ==========================================================================
# DEPLOY-S440-SHOWING-SLICE3.sh
# Showing routing Slice 3: agent shared-calendar self-confirm + handoff packet
# + pre-showing unconfirmed nudge + Overview coordination count.
#
# Migrations 0117 + 0118 are ALREADY APPLIED to the prod Supabase DB via the
# connector this session (they are global schema, verified + read back). This
# script only pushes the CODE (Vercel redeploys on push). The two .sql files are
# committed as source-of-truth history; nothing re-runs them.
#
# Runs git from the project root. Adds ONLY the Slice 3 files (leaves the
# unrelated pre-existing modified codex-handoffs + prior DEPLOY-*.sh untouched).
# ==========================================================================
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  lib/reminders.ts \
  lib/notifications.ts \
  app/agent/\[token\]/page.tsx \
  app/agent/\[token\]/actions.ts \
  app/api/cron/showing-confirmation-nudge/route.ts \
  app/dashboard/showings/actions.ts \
  app/dashboard/properties/actions.ts \
  "app/dashboard/properties/[id]/page.tsx" \
  app/dashboard/page.tsx \
  .github/workflows/reminders.yml \
  scripts/test-confirmation-nudge.ts \
  supabase/migrations/0117_agent_token_and_showing_packet.sql \
  supabase/migrations/0118_confirm_showing_from_token.sql

git commit -m "S440 Slice 3: agent shared-calendar self-confirm (/agent/[token]) + handoff packet (showing_instructions) + pre-showing unconfirmed nudge + Overview coordination count (migs 0117/0118 applied)"

git push origin HEAD

echo ""
echo "Pushed. Now VERIFY the Vercel deploy for this SHA appears (KI677):"
echo "  git rev-parse --short HEAD"
echo "If no build starts in ~1 min, nudge it:"
echo "  git commit --allow-empty -m 'redeploy nudge' && git push origin HEAD"
