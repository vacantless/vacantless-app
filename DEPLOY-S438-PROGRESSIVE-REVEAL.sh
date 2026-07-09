#!/usr/bin/env bash
# S438 follow-on - progressive sectional reveal on the public renter form.
# Makes the form feel short/un-daunting: "Your details" drops in once a viewing
# time is chosen (or the renter taps "can't make these times"); the optional
# "Help us prepare" group + the Confirm button drop in once name + email are
# filled. Sections stay in the DOM and toggle via a collapse class with a
# <noscript> override, so a no-JS renter still sees + can submit the whole form.
# View-layer only (app/r/[propertyId]/inquiry-form.tsx), no migration, no lib change.
# Gate: tsc clean, eslint clean.
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git add \
  app/r/\[propertyId\]/inquiry-form.tsx \
  DEPLOY-S438-PROGRESSIVE-REVEAL.sh

git commit -m "S438: progressive sectional reveal on the public renter form - details appear after a time is chosen, optional group + confirm after name+email (no-JS safe)"

git push origin main

echo "Pushed. Verify a Vercel build starts for this SHA; if it doesn't auto-deploy, re-trigger with an empty commit (git commit --allow-empty -m nudge && git push)."
