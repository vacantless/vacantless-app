#!/bin/bash
# S816i: Authorize the bank again, and a failed debit no longer reads "processing".
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816h-pad-mandate.ts
npx tsx scripts/test-stripe-connect.ts
npx tsx scripts/test-plain-language.ts
git add lib/stripe-connect.ts components/tenancy-stripe-rent-section.tsx scripts/test-s816h-pad-mandate.ts COMMIT-S816i-REAUTHORIZE.sh
git commit -m "S816i: Authorize the bank again; a failed debit reads as failed

Read on Neely's tenancy after S816h: the page offered only Refresh
authorization (re-reads the old mandate), so a tenant whose authorization
predates S816h had no way forward, and the uncollected \$5 read 'processing
at the bank'. Adds 'Authorize the bank again' whenever no rent is running,
and an unpaid invoice on a canceled or expired subscription now reads
'did not go through'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
