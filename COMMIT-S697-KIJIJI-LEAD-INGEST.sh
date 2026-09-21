#!/bin/bash
# S697: Kijiji lead ingest, built dark. COMMIT ONLY, never pushes.
set -e
cd "$(dirname "$0")"
if [ "$(uname -s)" = "Linux" ]; then
  B="$HOME/esb/node_modules/@esbuild/linux-arm64/bin/esbuild"; [ -x "$B" ] && export ESBUILD_BINARY_PATH="$B"
fi
pick_bin() { if [ -x "./node_modules/.bin/$1" ]; then echo "./node_modules/.bin/$1"; else echo "npx $1"; fi; }
TSX=$(pick_bin tsx); TSC=$(pick_bin tsc); ESLINT=$(pick_bin eslint)

echo "== tsc =="; $TSC --noEmit
echo "== eslint =="; $ESLINT lib/portal-senders.ts lib/portal-lead-email.ts lib/portal-lead-ingest-server.ts scripts/test-portal-lead-email.ts scripts/test-portal-senders.ts

echo "== the flag must stay DARK in the tree =="
# A registry entry is global the instant it deploys. If a default-on ever slips
# in, every org starts admitting Kijiji mail before one delivery has been
# watched, which is exactly the launch this gate exists to prevent.
if grep -rn "KIJIJI_LEAD_INGEST_ENABLED" --include=*.env* --include=*.json --include=*.yml . 2>/dev/null | grep -v node_modules | grep -q "true"; then
  echo "ABORT: KIJIJI_LEAD_INGEST_ENABLED is set true in the tree."; exit 1
fi
if ! grep -q 'KIJIJI_LEAD_INGEST_ENABLED !== "true"' lib/portal-lead-ingest-server.ts; then
  echo "ABORT: the kijiji dark gate is missing from the ingest route."; exit 1
fi
echo "  dark by default, gate present"

echo "== SPF ALONE MUST NOT BUY TRUST =="
# The single failure that would look like a working integration receiving
# nothing: Kijiji mail is SRS-rewritten in transit, so spf authenticates the
# forwarder. Only aligned DKIM may carry it.
$TSX -e '
import { isTrustedPortalSender } from "./lib/portal-senders";
const spfOnly = isTrustedPortalSender("noreply@rts.kijiji.ca", {
  "Authentication-Results": "spf=pass smtp.mailfrom=agileonline.ca",
});
const dkimAligned = isTrustedPortalSender("noreply@rts.kijiji.ca", {
  "Authentication-Results": "dkim=pass header.d=rts.kijiji.ca",
});
if (spfOnly) { console.error("ABORT: an SRS spf=pass was trusted."); process.exit(1); }
if (!dkimAligned) { console.error("ABORT: aligned DKIM was NOT trusted; every Kijiji lead would be dropped."); process.exit(1); }
console.log("  spf-only refused, aligned dkim trusted");
'

echo "== the named suites =="
for t in portal-lead-email portal-senders; do
  printf "  %-28s " "$t"; $TSX "scripts/test-$t.ts" >/dev/null 2>&1 && echo ok || { echo FAILED; exit 1; }
done

echo "== plain-language gate =="; $TSX scripts/test-plain-language.ts

git add lib/portal-senders.ts lib/portal-lead-email.ts lib/portal-lead-ingest-server.ts \
        scripts/test-portal-lead-email.ts scripts/test-portal-senders.ts \
        COMMIT-S697-KIJIJI-LEAD-INGEST.sh
git commit -F- <<'COMMITMSG'
S697: Kijiji lead ingest, read off two real messages, built dark

Kijiji has delivered over a thousand enquiries to an operator inbox and
four are in the database. This wires the ingest, and it is a platform
entry rather than a per-customer setup: one registry line lights Kijiji
up for every org, no SQL, no rows.

The format was READ, not guessed. Two real 2026 messages out of
rentals@agileonline.ca (uids 3613 and 3268), deliberately one with a
renter display name and one without, because that difference is the only
thing that reveals the label shape. Both are the fixtures.

THE SUBJECT IS NEVER PARSED FOR CONTACT DETAILS even though it carries
them. Kijiji ships everything as headers: Reply-To is the renter's real
email, X-Adid-Horizontal the ad id, X-Vip-Url the canonical ad, and
X-Kijiji-Re-Requestviewing the dates a renter asked to view. The sender
label is literally "Dee Dee(dnowlan8@gmail.com)", parentheses included,
and degrades to the bare email when the renter has no profile name, so
splitting the subject on "(" or on 'about "' breaks on real data.

An older Kijiji format exists (per-conversation masked relay, no headers,
renter email masked) and is deliberately NOT handled. It is historical;
a backfill would need a second parser. This corrects a claim made earlier
the same day that the current format was fabricated: it was not, and the
retraction is in claude/CORRECTION-S697-*.

THE REAL RISK IS NOT THE PARSER, IT IS THE FORWARD. This mail reaches an
operator inbox before it reaches us, so SRS rewrites the envelope and a
bare spf=pass authenticates the forwarder, never kijiji.ca. Aligned DKIM
(d=rts.kijiji.ca against the registered kijiji.ca) is the only signal
that can carry trust, and it survives only a forward that leaves the body
byte-for-byte intact. A webmail Forward button rewrites the body, breaks
the signature, and the guard then fail-closes: the integration looks
wired and admits nothing. The commit script asserts both directions.

Dark behind KIJIJI_LEAD_INGEST_ENABLED, unset everywhere. Registering a
sender and trusting it are two decisions on purpose.

Also portal-aware where it had been hardcoded to rentals_ca: ad-id
resolution (kijiji matches the id inside listing_posts.url, rentals_ca
inside notes), the cross-org guard, and the lead source label.

158 assertions, 0 failed. tsc and eslint green. No migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01T5vNLe7h1rxLs3UMLJ7tNT
COMMITMSG

echo
echo "COMMITTED. Not pushed."
GIT_OPTIONAL_LOCKS=0 git log --oneline -1
