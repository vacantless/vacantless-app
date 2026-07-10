#!/usr/bin/env bash
# S448 - upgrade the renter viewing emails with real arrival logistics (the
# confirmation-email content upgrade scoped in VIEWING-CONFIRMATION-TEMPLATE).
#
# WHAT: a shared viewingLogisticsHtml() block now renders, under the details box:
#   - Map + directions -> a tap-to-navigate Google Maps link (derived from the
#     address; always shown when there's an address).
#   - Getting in -> properties.showing_instructions (shown only when populated).
#   - "Running late or can't find the entrance?" -> call/text the org's public
#     phone (shown only when organizations.public_contact_phone is set) - the fix
#     for the intercom-arrival leak.
#   - Photo ID + ~10-15 min + "your leasing agent will meet you there".
# The awkward "in-person viewing (not a phone call)" line is reframed positively
# and now also rules out a video call, across all three renter emails (booking
# confirmation, reschedule, reminder). No em dashes.
#
# WIRING: the public /r booking path is anon and can't read showing_instructions /
# public_contact_phone directly, so a tiny isolated SECURITY DEFINER helper RPC
# get_booking_confirmation_extras (migration 0123, ALREADY APPLIED) returns both;
# attemptBooking calls it and threads them into sendBookingConfirmation. The
# reschedule + reminder emails get the map link + reframed copy now; threading the
# access-notes/phone into those two is a follow-up (they run from other paths).
# book_public_showing was deliberately NOT touched (keep the critical RPC stable).
#
# DEGRADES CLEANLY: every line is conditional. Today Pillette units have
# showing_instructions=null so the "Getting in" line is hidden; the map + call/text
# (226-773-7555, Agile's public_contact_phone) render now.
#
# Gate: tsc clean, eslint clean, tests green (booking 54, reminders 13, leads-notify 20).
#
# AFTER DEPLOY, to finish the content upgrade (Noam):
#   1. Populate properties.showing_instructions for the live 833 Pillette units
#      (entrance/intercom/meet-up note) so the "Getting in:" line renders.
#   2. If you want the 519-915-8865 leasing line shown instead of 226-773-7555,
#      update Agile's Public contact phone in Settings (the email uses that field).
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  'supabase/migrations/0123_booking_confirmation_extras.sql' \
  'lib/email.ts' \
  'app/r/[propertyId]/actions.ts' \
  DEPLOY-S448-CONFIRMATION-EMAIL-UPGRADE.sh

git commit -m "S448: viewing emails carry arrival logistics - Google Maps link, access notes (showing_instructions), call/text-if-late number, photo-ID/duration; reframed in-person copy. Isolated extras RPC (0123); booking RPC untouched"
git push

echo
echo "Pushed. Migration 0123 already applied (connector). Verify the Vercel deploy for this SHA (KI677); then book a test viewing on North Star and confirm the map + call/text lines render."
git rev-parse --short HEAD
