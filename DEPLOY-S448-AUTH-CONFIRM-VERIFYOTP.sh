#!/usr/bin/env bash
# S448 - durable fix for the "password reset email keeps looping" bug that
# blocked Paul Schwartz (thadmumford2020@gmail.com, org 1a28fea7).
#
# ROOT CAUSE: the self-serve forgot-password flow uses the browser Supabase
# client, which defaults to the PKCE flow. resetPasswordForEmail then emails a
# ?code link that can ONLY be finished in the SAME browser that requested it
# (the code_verifier lives in that browser's localStorage). It silently dies
# when the landlord opens the link in the Gmail in-app browser, on a second
# device, or when an email security scanner pre-fetches the one-time link ->
# "this link didn't work" -> request again -> endless resend loop. (The S447
# fix only repaired the operator-PROVISIONED link, which is server-generated
# and uses the verifier-free implicit #hash flow.)
#
# FIX: add a verifier-free finalizer route /auth/confirm that verifies the
# hashed OTP server-side (verifyOtp with token_hash + type). Once the email
# templates point here (see the MANUAL STEP below), a recovery / signup /
# invite link works from ANY browser or device.
#
# WHAT SHIPS (code only, no migration):
#   - lib/auth-confirm.ts       pure helpers (type allowlist + open-redirect
#                               guard on ?next) - unit tested.
#   - app/auth/confirm/route.ts GET handler: verifyOtp, then redirect to ?next;
#                               on any failure -> /auth/callback#error (reuses
#                               the existing "this link didn't work" screen).
#   - scripts/test-auth-confirm.ts  19 tests.
# /auth/callback (PKCE ?code + implicit #hash) is UNTOUCHED and still handles
# the operator-provisioned links. Shipping this route alone changes NOTHING for
# users until the templates are switched - it is a safe, additive deploy.
#
# Gate: tsc clean, eslint clean, test-auth-confirm 19/0.
#
# ================= MANUAL STEP (Noam) - AFTER this deploy is READY =================
# In the Supabase dashboard -> Authentication -> Email Templates, repoint the
# links to /auth/confirm (see AUTH-RECOVERY-TOKEN-HASH-TEMPLATE-EDITS-2026-07-10.md
# for the exact HTML). Do it in this order so no link 404s:
#   1. Confirm the Vercel deploy for this SHA is READY (so /auth/confirm exists).
#   2. Edit the "Reset Password" template ->
#        {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
#      (optional but recommended: "Confirm signup" -> type=signup&next=/onboarding;
#       "Invite user" -> type=invite&next=/reset-password).
#   3. TEST: forgot-password for a test address, open the emailed link in a
#      DIFFERENT browser than you requested from (or your phone) -> it must land
#      on /reset-password "Choose a new password", not loop. That cross-browser
#      open is the whole point - it is what was broken.
# Do NOT touch URL Configuration -> Redirect URLs; /auth/confirm is same-origin.
# ==================================================================================
set -euo pipefail

cd "/Users/noammuscovitch/Documents/Claude/Projects/Agile Lead to Lease Engine/vacantless-app"

git rev-parse --is-inside-work-tree >/dev/null

git add \
  'lib/auth-confirm.ts' \
  'app/auth/confirm/route.ts' \
  'scripts/test-auth-confirm.ts' \
  DEPLOY-S448-AUTH-CONFIRM-VERIFYOTP.sh

git commit -m "S448: add verifier-free /auth/confirm (token_hash + verifyOtp) so recovery/signup/invite links work from any browser or device - fixes the PKCE forgot-password resend loop; /auth/callback untouched"
git push

echo
echo "Pushed. No migration. Verify the Vercel deploy for this SHA appears + goes READY (KI677),"
echo "THEN do the MANUAL email-template edits (see the header + the template-edits doc), then cross-browser test."
git rev-parse --short HEAD
