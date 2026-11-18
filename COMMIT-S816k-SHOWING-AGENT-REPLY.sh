#!/bin/bash
# S816k: Quick replies say the showing agent will get back to the renter.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
for t in test-marketplace-helper test-listing-copy test-s750-reply-kit test-plain-language; do
  [ -f scripts/$t.ts ] && npx tsx scripts/$t.ts
done
git add lib/listing-copy.ts lib/marketplace-helper.ts COMMIT-S816k-SHOWING-AGENT-REPLY.sh
git commit -m "S816k: renter reply says the showing agent will get back to them

Noam 2026-11-18: on Quick replies, change 'we will get back to you' to
'the showing agent will get back to you'. The no-viewing-times reply now
reads: 'The showing agent will get back to you to set a time.' Same words
in the Marketplace helper and the listing kit reply.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
