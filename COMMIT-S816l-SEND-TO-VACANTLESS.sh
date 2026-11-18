#!/bin/bash
# S816l: "Send to Vacantless" from the iPhone share menu saves the renter from a chat screenshot.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
npx tsc --noEmit -p .
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-plain-language.ts
npx tsx scripts/test-s750-reply-kit.ts
npx tsx scripts/test-chat-leads.ts
git add supabase/migrations/0306_capture_keys.sql lib/send-shortcut.ts lib/send-shortcut-copy.ts lib/send-shortcut-server.ts \
  app/api/shortcut/renter/route.ts app/dashboard/replies/send-shortcut-card.tsx app/dashboard/replies/actions.ts \
  app/dashboard/replies/page.tsx scripts/test-s816l-send-shortcut.ts scripts/test-plain-language.ts scripts/plain-language-baseline.json \
  COPY-SQL-0306.sh COMMIT-S816l-SEND-TO-VACANTLESS.sh
git commit -m "S816l: Send to Vacantless from the iPhone share menu

Noam 2026-11-18: make Messenger on the iPhone and Quick replies work
together better. Facebook gives no way to read personal chats, and Quick
replies saved 0 of 14 Marketplace renters since Nov 9, so saving the renter
is the gap.

A landlord makes a key on Quick replies (stored as sha256 only, migration
0306 capture_keys, own rows readable, writes server only). An Apple
Shortcut in the share menu posts a chat screenshot with the key to
/api/shortcut/renter. The AI reads name, contact, question and which rental
(same read as the screenshot upload), then saves the renter: name only on a
rental goes through saveChatRenter (one per name per rental, merges when
they book), email or phone makes a full renter, deduped on 14 days. The
Shortcut shows one plain line and the renter's page. Role checked on every
send, 60 reads per key per hour. Steps to build the Shortcut by hand show
until NEXT_PUBLIC_SEND_SHORTCUT_URL holds a shared Shortcut link.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMz8oSgzAZqtkqGS3"
git push origin main || git push origin main
echo "== done"; git log --oneline -1
