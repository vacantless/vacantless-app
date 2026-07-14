#!/usr/bin/env bash
# S426 - Homepage best-in-class pass + the outstanding Codex handoff doc.
#   Commit 1: the S426 lease-OCR P2-fix handoff (so Codex can read it from the repo).
#   Commit 2: homepage redesign -
#     - hero pivot to the "never miss the work that costs you money" promise
#     - two new lead sections: LeasingProof (verified own-rental stats) + NeverMiss
#       (compliance pillars) with the shared Icons set (calendar/clock/users/wrench)
#     - themeable brand: forest-green default via --color-primary tokens in
#       globals.css; page.tsx now references var(--color-primary/-hover/-accent/
#       -accent-strong) so a white-label customer overrides ONE seed hex.
#   Guardrails kept: no overclaim on syndication / rent-collection / e-sign / serve /
#   file / vendor dispatch / "replaces your property manager". Gate: tsc clean.
set -euo pipefail
cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"
git add codex-handoffs/S426-LEASE-OCR-P2-FIXES.md
git commit -m "docs(S426): Codex handoff for lease-OCR P2 fixes + live-QA result"
git add app/page.tsx app/globals.css components/icons.tsx
git commit -m "S426: homepage best-in-class pass - never-miss hero pivot, leasing-proof + never-miss lead sections, shared Icons iconography, themeable --color-primary (forest-green default)"
git push origin main
