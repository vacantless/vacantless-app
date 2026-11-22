#!/bin/bash
# S830a/b/c: Send to Vacantless copies the right reply for viewing, "I sent the form" and rent offers, and never saves agents or promoters.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q 'answerKeyForTopic' lib/send-shortcut.ts || { echo "STOP: S830a edit missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s830-shortcut-topics.ts
npx tsx scripts/test-s830c-proxy-wallet-line.ts
node scripts/run-all-tests.mjs
git add lib/reply-answers.ts lib/reply-kit.ts lib/send-shortcut.ts lib/send-shortcut-server.ts lib/ai-enquiry.ts lib/ai-screenshot-lead.ts \
  app/api/shortcut/renter/route.ts scripts/test-s830-shortcut-topics.ts scripts/test-s816l-send-shortcut.ts scripts/test-s812-reply-answers.ts \
  COMMIT-S830a-SHORTCUT-TOPICS.sh
git commit -m "S830a/b: Send to Vacantless answers viewing, sent-the-form and rent offers; skips agents

Noam's 93 Marketplace chats since Nov 1 (REVIEW-S830): 36 would have
copied a wrong or empty reply. Viewing questions got the move-in date or
the plain link, renters who already sent the form got the link again, rent
offers got the utilities answer. The screenshot reader now names the topic
(viewing, applied, rent, lease, pets and so on) and that picks the reply;
the word rules stay as the fallback, reordered. Three stock replies in
Noam's words, also on Quick replies as chips: Viewing time, Sent the form,
Rent offer. Lease and other questions copy nothing (no guessing). The
reader also flags agents selling tenants, promoters and spam; those are
not saved. Same-price rentals return no rental instead of a guess.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGo6sCsrGeBAq56QJdq"
# S830c: the proxy Wallet line in the daily health email (second commit).
git add lib/health-digest.ts app/api/cron/health-digest/route.ts scripts/test-s830c-proxy-wallet-line.ts
git commit -m "S830c: the daily health email warns when the robot's Decodo proxy is short

Decodo Pay As You Go takes each next GB (\$4) from the Wallet at 90% use;
a short Wallet pauses it and the robot's proxy fails (KI1756, S829).
Decodo's API has no Wallet balance, so the email now (1) explains a robot
post that failed with a proxy connection error (Wallet, Turn ON) and
(2) with DECODO_API_KEY set in Vercel, warns at 80% of the GB block. The
key lives only in Vercel. Without it the email says the proxy was not
checked.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGo6sCsrGeBAq56QJdq"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
