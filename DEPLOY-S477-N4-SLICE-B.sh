#!/usr/bin/env bash
# S477 - N4 notice-library, Slice B (official gov-form fill). Extends the N1
# frozen-snapshot -> pdf-lib fill pattern to the LTB Form N4. CODE + a bundled
# template asset; NO migration, NO route wired yet (prepare-only; Slice C adds the
# operator serve flow behind the legal-verify gate), so no app behaviour changes.
#
# Files:
#   lib/forms/ltb-n4-2015.pdf   - the Board-approved Form N4 (rev 2015-11-30),
#       XFA-stripped + normalized offline (qpdf --qdf rebuild -> pdf-lib drops XFA
#       -> recompressed to 759KB). 43 AcroForm fields, 3 pages.
#   lib/forms/shared-combs.ts   - generalized comb formatters (date "DD MM YYYY";
#       amount = dollar cells + blank-over-"." + cents, width-parameterized for the
#       N4's 9/10/11-cell amount fields). Go-forward shared toolkit.
#   lib/n4-official-pdf.ts      - fillOfficialN4(snapshot) -> filled PDF bytes;
#       strips leftover LiveCycle JS, no flatten (same as N1). Landlord or agent
#       signer (SelectSign 1/2); Signature/SignDate left blank for the wet/e-sign.
#   lib/n4.ts (edit)            - packN4ArrearsRows (the LTB 3-row overflow rule:
#       combine all-but-last into row 1, last period alone in row 2), endOfMonthISO,
#       bi_weekly unit (=14d per the N4 instructions), from/to on derived rows.
#   scripts/test-n4.ts (edit)   - 70/0 (packing, overflow combine, comb formatters,
#       endOfMonth, bi-weekly).
#   scripts/test-n4-pdf.ts      - 17/0 golden readback: fills a known snapshot,
#       reloads, asserts every mapped field's comb value (visual comb alignment
#       confirmed on a rendered sample).
#
# Verified on device: tsc --noEmit clean; eslint clean (5 files); tests via the
#   CJS-transpile+node path 70/0 + 17/0; sample PDF rendered + human-verified.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git rev-parse --is-inside-work-tree >/dev/null

node_modules/.bin/tsx scripts/test-n4.ts       # expect test-n4: 70/0
node_modules/.bin/tsx scripts/test-n4-pdf.ts   # expect test-n4-pdf: 17/0
npm run build                                  # KI741 - gate on the real build

git add \
  lib/forms/ltb-n4-2015.pdf \
  lib/forms/shared-combs.ts \
  lib/n4-official-pdf.ts \
  lib/n4.ts \
  scripts/test-n4.ts \
  scripts/test-n4-pdf.ts \
  DEPLOY-S477-N4-SLICE-B.sh

git commit -m "S477: N4 notice-library Slice B - official Form N4 fill (fillOfficialN4 + shared combs + 3-row overflow) + tests (70/0, 17/0)"
git push

echo
echo "Pushed. NO migration, no route yet (prepare-only). Verify Vercel READY (KI677)."
git rev-parse --short HEAD
