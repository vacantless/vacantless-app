#!/bin/bash
# S824a+b+c: phone save keeps the new question, Offer times opens for renters who could not book,
# the reply drops a dead booking link, and the Reports funnel bar counts what the Rented card counts.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-reports.ts
npx tsx scripts/test-lead-detail.ts
npx tsx scripts/test-chat-leads.ts
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-viewing-offers.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add lib/chat-leads.ts lib/chat-leads-server.ts lib/send-shortcut.ts lib/send-shortcut-server.ts lib/reports.ts app/dashboard/reports/page.tsx "app/dashboard/leads/[id]/page.tsx" scripts/test-reports.ts scripts/test-lead-detail.ts scripts/test-chat-leads.ts scripts/test-s816l-send-shortcut.ts COMMIT-S824a-QUESTION-OFFER-OPEN-RENTED-BAR.sh
git commit -m "S824a+b+c: keep the renter's new question, open Offer times, match the Rented bar

S824a, Send to Vacantless on a renter already saved:
- The screenshot's question was dropped when the renter was already in
  Renters (same email or phone, or the same chat name on the rental).
- It now goes on their page as an activity note, once, and the phone line
  says Their new question is on their page.

S824b, Reports:
- The funnel's last bar is Rented and counts what the Rented card counts
  (rentals marked rented, or renters set to Leased, whichever is larger).
  Percentages stop at 100.

S824c, renter page (read on Agile's Unit 9 renters):
- Offer times to this renter opens by itself for a renter tagged no
  suitable time, or when the rental has no viewing time open.
- The reply draft links to the rental page only when it has a time to
  pick (the same check the Marketplace replies use); otherwise it offers
  to share times.
- The no-viewings line points to Offer times instead of Set viewing times.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq4W8hFu15eRRP3WoB"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
