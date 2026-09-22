#!/bin/bash
# S697c: site senders no longer dropped as auto-replies + the self-serve inquiry card.
# COMMIT ONLY, never pushes. Migration 0227 is ALREADY APPLIED to PROD.
set -e
cd "$(dirname "$0")"
pick_bin() { if [ -x "./node_modules/.bin/$1" ]; then echo "./node_modules/.bin/$1"; else echo "npx $1"; fi; }
TSX=$(pick_bin tsx); TSC=$(pick_bin tsc)
echo "== tsc =="; $TSC --noEmit
for t in test-portal-inbox test-portal-lead-ingest test-inbound-postmark-dispatch test-portal-senders test-portal-lead-email test-email-ingest; do
  echo "== $t =="; $TSX scripts/$t.ts
done
echo "== plain language =="; $TSX scripts/test-plain-language.ts
git add \
  lib/portal-inbox.ts \
  lib/portal-lead-ingest-server.ts \
  lib/inbound-postmark-dispatch.ts \
  components/copy-text-button.tsx \
  app/dashboard/link-portals/portal-inbox-card.tsx \
  app/dashboard/link-portals/actions.ts \
  app/dashboard/link-portals/page.tsx \
  messages/en.json messages/fr.json \
  supabase/migrations/0227_inbound_portal_events.sql \
  scripts/test-portal-inbox.ts \
  scripts/test-portal-lead-ingest.ts \
  scripts/test-inbound-postmark-dispatch.ts \
  .gitignore \
  COMMIT-S697c-INQUIRY-CARD-AND-NOREPLY-FIX.sh
git commit -F- <<'COMMITMSG'
S697c: stop dropping site inquiries as auto-replies; self-serve inquiry card

THE BUG. The lead webhook ran the loop guard before anything else, and the
guard drops any sender matching "noreply". Kijiji sends every inquiry from
noreply@rts.kijiji.ca, and Rentals.ca also uses no-reply@rentals.ca. So
every Kijiji inquiry was answered "auto_reply" and discarded the moment
KIJIJI_LEAD_INGEST_ENABLED went on. Known site senders now skip the loop
guard; they never auto-reply to us and stay held to the aligned auth
guard. A regression test replays the real Kijiji shape, including
Precedence: bulk and Auto-Submitted.

THE CARD. "Get your inquiries here" on the rental sites page, so a new
landlord connects Kijiji and Rentals.ca without writing to us:
- their Vacantless address, minted there if missing, not plan-gated
- the exact senders to make an email rule for, read from the same
  registry the webhook trusts
- per site Ready / Needs you / Not yet, from what actually arrived
- Gmail's forwarding code. Gmail will not forward until the owner types
  a code it emails to the new address, which is ours, so that code was
  dropped and a Gmail landlord could never finish. The webhook now keeps
  it (digits only, aligned google.com auth only) and the card shows it.

0227 inbound_portal_events: source, outcome, time, and the Gmail code.
No renter data. Members read, service role writes. Recording is best
effort and never costs a renter.

Unverified: Gmail's code format is its long-standing one, not read off a
captured 2026 message. Subject and body are both read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T5vNLe7h1rxLs3UMLJ7tNT
COMMITMSG
echo "COMMITTED. Not pushed. Push with: git push"; GIT_OPTIONAL_LOCKS=0 git log --oneline -1
