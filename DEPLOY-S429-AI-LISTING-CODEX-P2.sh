#!/usr/bin/env bash
# S429 - Fold Codex's one P2 on the AI listing-import feature (c96b677..e753850 review).
#   P2: AI rent normalization could persist a rent 100x too low. A model that
#       returns a DOLLAR figure despite the "integer cents" contract ("$1,850",
#       "1850", "1850.00") went through clampInt, which stripped $/, but did NOT
#       scale dollars->cents, so "$1,850" -> 1850 cents = $18.50/mo on the draft.
#       New clampRentCents detects the dollar case ($ sign, a fractional value, or
#       a bare integer implausibly low as cents < $100/mo) and scales x100; a value
#       already in cents is kept. (lib/listing-extract.ts + tests)
# Gate: test-listing-extract 68/0 (+6 new), test-billing 254/0, test-mls-import
#       108/0, tsc --noEmit clean, eslint clean on touched files. Still ships DARK.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git add lib/listing-extract.ts scripts/test-listing-extract.ts
git commit -m "S429: AI listing-import Codex P2 - clampRentCents scales dollar-denominated model output to cents (never persist a 100x-too-low rent)"
git push origin main
