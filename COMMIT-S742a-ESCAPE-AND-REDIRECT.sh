#!/bin/bash
# S742a: auto-reply template values escaped; /auth/callback uses the shared next guard.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-auth-confirm.ts
npx tsx scripts/test-auto-reply-booking-link.ts
npx tsx scripts/test-s716-login-next.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/email.ts lib/auth-confirm.ts app/auth/callback/page.tsx \
  scripts/test-auth-confirm.ts scripts/test-auto-reply-booking-link.ts \
  COMMIT-S742a-ESCAPE-AND-REDIRECT.sh COMMIT-S742a-MESSAGE.txt
git commit -F COMMIT-S742a-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
