#!/bin/bash
# S834b: the property manager line in the pays-for-itself table, and linked
# Stripe and Rotessa price sources under the rent cost table.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
grep -q "S834b" lib/vendor-costs.ts || { echo "STOP: S834b edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s832-vendor-costs.ts
node scripts/run-all-tests.mjs
git add lib/vendor-costs.ts components/vendor-cost-table.tsx lib/rent-rail-costs.ts \
  components/rent-cost-table.tsx scripts/test-s832-vendor-costs.ts COMMIT-S834b-MANAGER-LINE-SOURCES.sh
git --no-pager diff --cached --name-only
git commit -m "S834b: property manager line, linked rent price sources

Noam: hiring a property manager to collect rent is part of the job.
The pays-for-itself table gets a share-of-rent line: a property manager
to find tenants and collect rent, about 7% of the monthly rent (Bark
Canada, tenant-find and rent collection tier), worked on a \$1,500 rent
(about CA\$105 a month). It sits in its own group, is never added to the
monthly-apps subtotal, and says in-person showings and visits stay with
the landlord. The rent cost table now links Stripe's and Rotessa's
pricing pages, so every number shows where it came from.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGogwZs9kDhv2v4gMSa"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
