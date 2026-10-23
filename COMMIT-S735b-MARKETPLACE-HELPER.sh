#!/bin/bash
# S735b: the Marketplace helper (app side; the extension v1.0.0 is its own
# repo, COMMIT-S735-HELPER.sh there) and review item 7, the one-sitting
# sign-in chain (/dashboard/site-signin). Re-run after the first attempt
# failed on a quote inside the commit message: the message is a file now.
set -e
cd "$(dirname "$0")"
rm -f .git/index.lock
echo "== gates"
npx tsc --noEmit
npx tsx scripts/test-marketplace-helper.ts
npx tsx scripts/test-site-signin-chain.ts
npx tsx scripts/test-plain-language.ts
npm run build
echo "== commit"
git add lib/marketplace-helper.ts scripts/test-marketplace-helper.ts \
  "app/dashboard/properties/[id]/marketplace-row.tsx" \
  "app/dashboard/properties/[id]/page.tsx" \
  scripts/plain-language-baseline.json scripts/test-plain-language.ts \
  lib/site-signin.ts scripts/test-site-signin-chain.ts \
  app/dashboard/site-signin/page.tsx \
  "app/dashboard/site-signin/[channel]/page.tsx" \
  "app/dashboard/site-signin/[channel]/actions.ts" \
  "app/dashboard/site-signin/[channel]/window-panel.tsx" \
  app/dashboard/link-portals/page.tsx \
  COMMIT-S735b-MARKETPLACE-HELPER.sh COMMIT-S735b-MESSAGE.txt
git commit -F COMMIT-S735b-MESSAGE.txt
git push origin main
echo "== done"; git log --oneline -1
