#!/bin/bash
# S840f: paste a one-time code for the sign-in window on the Vacantless page;
# honest start time; "you can close the tab" when signed in. Migration 0333.
set -eo pipefail
cd "$HOME/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
rm -f .git/index.lock
if find node_modules -maxdepth 3 -name "* 2" 2>/dev/null | grep -q .; then rm -rf node_modules .next && npm ci; fi
find node_modules -maxdepth 3 -name "* [0-9]" -prune -exec rm -rf {} +
grep -q "export async function sendSiteSigninCode" "app/dashboard/site-signin/[channel]/actions.ts" || { echo "STOP: S840f action missing"; exit 1; }
npx tsc --noEmit -p .
npx tsx scripts/test-s840f-signin-code-box.ts
node scripts/run-all-tests.mjs
git add lib/site-signin.ts "app/dashboard/site-signin/[channel]/actions.ts" \
  "app/dashboard/site-signin/[channel]/window-panel.tsx" \
  supabase/migrations/0333_signin_window_type_code.sql \
  scripts/test-s840f-signin-code-box.ts scripts/test-site-signin.ts \
  COMMIT-S840f-SIGNIN-CODE-BOX.sh
git --no-pager diff --cached --name-only
git commit -m "S840f: paste a sign-in code on the Vacantless page; honest window wording

Noam, 2026-11-24, signing Agile in to Zumper: the window is a remote screen,
so a code copied from an email could not be pasted into it, and after a good
sign-in the window tab sat on \"connecting\" with no word.
- A box under the window: \"Got a code by email or text?\" The code (4 to 12
  letters or digits, never a password) is saved on the window's row
  (0333 type_code); the worker types it where the cursor is and clears it.
- \"This takes a minute or two\" (measured 95 s), and the done card says the
  sign-in window tab can be closed.
Worker half: vacantless-worker S840w.

Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MTgxGrMLwSHQkDAVv4gVne"
git push origin main || git push origin main
echo "== done"; git --no-pager log --oneline -1
