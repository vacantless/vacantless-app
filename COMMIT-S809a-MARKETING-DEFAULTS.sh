#!/bin/bash
# S809a: marketing pass for S805 to S808 (building defaults line, "renter" not "inquiry").
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s809a-msg.txt <<'MSG'
S809a: marketing pass for S805 to S808

- Homepage "Your ads": set your building's parking and its fee, laundry,
  appliances and what's nearby once; every ad uses them, on Kijiji,
  Rentals.ca and Zumper too (S808a defaults + S809w robot fills).
- Tools pages (N4, N8, N12, rent increase, standard lease, tools index) and
  the realtors page say "every renter", not "every inquiry" (S806 house
  words).
- Already current, checked: repairs by text on the homepage Repairs card,
  rent collection free on the Free card, no Kijiji "Needs you", no
  link-portals link on public pages, no screening or market-rent claims.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqw2x3R4yHt5egsYRV
MSG
git add app/page.tsx app/realtors/page.tsx app/tools/page.tsx app/tools/n4/page.tsx app/tools/n8/page.tsx app/tools/n12/page.tsx app/tools/rent-increase/page.tsx app/tools/standard-lease/page.tsx COMMIT-S809a-MARKETING-DEFAULTS.sh
git commit -F /tmp/s809a-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
