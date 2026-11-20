#!/bin/bash
# S824d: set up the phone by QR code (no sign-in on the phone), and one tap on an iPhone.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
npm ci --dry-run >/dev/null
npx tsc --noEmit -p .
npx tsx scripts/test-s824d-phone-setup.ts
npx tsx scripts/test-s816l-send-shortcut.ts
npx tsx scripts/test-s821b-start-here-android-share.ts
npx tsx scripts/test-onboarding-emails.ts
npx tsx scripts/test-onboarding-wizard.ts
npx tsx scripts/test-plain-language.ts
node scripts/run-all-tests.mjs
git add supabase/migrations/0314_phone_setup_links.sql lib/phone-setup.ts lib/phone-setup-server.ts lib/copy-then-open.ts "app/phone/[token]/page.tsx" "app/phone/[token]/actions.ts" "app/phone/[token]/phone-setup.tsx" app/dashboard/replies/actions.ts app/dashboard/replies/send-shortcut-card.tsx lib/onboarding-wizard.ts lib/onboarding-emails.ts scripts/test-s824d-phone-setup.ts scripts/test-s821b-start-here-android-share.ts COMMIT-S824d-PHONE-SETUP-QR.sh
git commit -m "S824d: set up the phone by QR code, one tap on an iPhone

Send to Vacantless took about eight taps on two devices: sign in on the
phone, make a key, copy it, download the Shortcut, find it in Downloads,
add it, paste the key.

Now, on a computer, Quick replies shows Show a code for my phone. The
phone scans it and opens /phone/<code>. One tap there:
- signs that phone in (two-step still asks for its code),
- opens the same account,
- on iPhone makes the key, copies it and opens the Shortcut, so the
  person only taps Paste and Add Shortcut,
- on Android goes to the install steps on Quick replies.

On an iPhone already signed in, Quick replies has the same one button.
A code works once, for 15 minutes; opening the page uses nothing, only
the tap does. Migration 0314: phone_setup_links, server only.
Getting started and the welcome email say scan the code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGq4W8hFu15eRRP3WoB"
git push origin main || git push origin main
echo "== done"; git log --oneline -2
