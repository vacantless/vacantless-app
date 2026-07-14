#!/usr/bin/env bash
# S427b - fold Codex's one P2 on the S427 batch: the Money hub "Reports" card
# promised owner statements/rent roll but linked to /dashboard/reports, which is
# the LEASING FUNNEL report - and nav marked that route a Money child, so Money
# lit up on a non-money page. Fix:
#   - money hub "Reports" card -> "Owner statement" -> /dashboard/rent/statement
#     (the real money report; rent-roll is its sibling under /dashboard/rent).
#   - nav: drop /dashboard/reports from Money's match; add it to Leasing's match.
#   - leasing hub: add a "Reports" card for the funnel report so it has a home.
# Gate: tsc + eslint clean.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add app/dashboard/money/page.tsx app/dashboard/dashboard-nav.tsx app/dashboard/leasing/page.tsx codex-handoffs/S427-APP-UNIFICATION.md
git commit -m "S427b: fold Codex P2 - Money 'Reports' -> owner statement (money report); leasing funnel report moves under Leasing"
git push origin main
