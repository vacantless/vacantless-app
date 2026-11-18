#!/bin/bash
# S817c: when Rentals.ca, Kijiji or Zumper emails "confirm your email" to a Vacantless address, Vacantless opens the link itself.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-site-mail-pass.ts
npx tsx scripts/test-portal-lead-ingest.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/site-mail-pass.ts lib/site-mail-pass-server.ts lib/portal-lead-ingest-server.ts scripts/test-site-mail-pass.ts COMMIT-S817c-SITE-CONFIRM-LINK.sh
git commit -m "S817c: open the site's confirm-your-email link for the landlord

The S817 trial log showed why Rentals.ca refused every log-in from GitHub:
401 'Email address has not been validated'. Make my account signs up with
the Vacantless address, so the site's confirmation email lands with us and
nobody opened it. Now a trusted site email (aligned auth, site domain) whose
subject asks to confirm the address has its Validate/Verify/Confirm button
opened from the server, following redirects only on the site's own domain.
Never a password reset or a log-in code. The copy still goes to the owner
with one line saying it was confirmed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqHBdFvs17yuYwWkhZ"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
