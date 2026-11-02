#!/bin/bash
# S742b: honeypot + per-connection and per-rental limits on the public renter form.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-public-submit-limit.ts
npx tsx scripts/test-no-client-secret-imports.ts
npx tsx scripts/test-plain-language.ts
echo "== commit"
git add lib/public-submit-limit.ts lib/public-submit-fields.ts \
  "app/r/[propertyId]/actions.ts" "app/r/[propertyId]/inquiry-form.tsx" "app/r/[propertyId]/page.tsx" \
  supabase/migrations/0263_public_submit_limits.sql scripts/test-public-submit-limit.ts \
  COMMIT-S742b-PUBLIC-FORM-LIMIT.sh COMMIT-S742b-MESSAGE.txt
git commit -F COMMIT-S742b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
