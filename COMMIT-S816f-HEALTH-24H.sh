#!/bin/bash
# S816f: the health email counts only bounces from the last 24 hours.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-health-digest.ts
git add app/api/cron/health-digest/route.ts scripts/test-health-digest.ts COMMIT-S816f-HEALTH-24H.sh
git commit -m "S816f: the health email counts only bounces from the last 24 hours

Noam 2026-11-18: 'we had 2 health problems'. The demo@ bounce from the
Nov 16 repairs test (fixed in S809b) showed on Nov 17 and Nov 18 because
Brevo's days=1 spans about two calendar days. Events are now kept only if
they are newer than 24 hours. The other line (S799 Rentals.ca email not
parsed, 2026-11-18 01:25Z) was the S815a bug before it shipped.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
