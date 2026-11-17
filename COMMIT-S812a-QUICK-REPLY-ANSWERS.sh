#!/bin/bash
# S812a: Quick replies answers common questions; Copy also saves the renter.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit
node scripts/run-all-tests.mjs
cat > /tmp/s812a-msg.txt <<'MSG'
S812a: Quick replies answers common questions; Copy also saves the renter

Noam asked (2026-11-17) for Quick replies to be easier to use. Two changes,
both on the phone page, no helper change (1.2.6 is still in store review).

1. "They asked about". Each available rental's card gets a row of buttons
   (Pets, Utilities, Parking, Laundry, Move-in date, Appliances, Air
   conditioning) beside "Is it available?". A tap swaps the reply for the
   answer plus the site's own booking link. Answers come from the rental's
   details with the account and building defaults merged in, the same merge
   as the rental page. A button shows only when the record holds the fact:
   an unanswered parking line gives no Parking button, so nobody pastes a
   guess. Rented rentals keep the one "rented" reply.

2. With a name typed, Copy or Share also saves the renter in Renters (once
   per name per card), so "Add this renter" is no longer a second tap. The
   button stays for adding without copying. A "Clear the name" link sits
   under the name box.

- lib/reply-answers.ts (new, pure)
- lib/reply-kit.ts (cards carry answers; replyKitText takes answerKey)
- app/dashboard/replies/page.tsx (reads details and defaults on their own;
  a failed read only hides the answers)
- app/dashboard/replies/reply-kit.tsx
- scripts/test-s812-reply-answers.ts (37 checks)

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGqVR5owGBGyB57WeXJ
MSG
git add lib/reply-answers.ts lib/reply-kit.ts app/dashboard/replies/page.tsx app/dashboard/replies/reply-kit.tsx scripts/test-s812-reply-answers.ts COMMIT-S812a-QUICK-REPLY-ANSWERS.sh
git commit -F /tmp/s812a-msg.txt
git push origin main || git push origin main
echo "== done"; git log --oneline -1
