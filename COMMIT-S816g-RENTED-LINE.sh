#!/bin/bash
# S816g: the Rented email says what really happened to the ads.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816g-rented-line.ts
npx tsx scripts/test-unit-progress.ts
git add lib/unit-progress.ts lib/unit-progress-server.ts lib/unit-progress-notify.ts scripts/test-s816g-rented-line.ts COMMIT-S816g-RENTED-LINE.sh
git commit -m "S816g: the Rented email says what really happened to the ads

First live Rented tap (Narayan, 833 Pillette Unit 32, 2026-11-17 22:56):
the email said 'Its ads are coming down' but the unit had no live ads
(no listing_posts, no runs). Live ads are now counted before the takedown
and the line says none, one, or how many.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
