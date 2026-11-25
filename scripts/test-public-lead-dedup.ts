// Unit tests for /r public-lead dedup helpers and the S494 migration contract.
// Run: npx tsx scripts/test-public-lead-dedup.ts
import { readFileSync } from "node:fs";
import {
  PUBLIC_LEAD_DEDUP_OPEN_STATUSES,
  findReusablePublicLead,
  normalizePublicLeadDedupEmail,
  publicLeadSubmitEffects,
  type PublicLeadDedupCandidate,
} from "../lib/public-lead-dedup";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const now = "2026-07-15T15:00:00.000Z";
const orgId = "921f7c08-0000-0000-0000-000000000000";
const propertyId = "83300000-0000-0000-0000-000000000020";

const candidates: PublicLeadDedupCandidate[] = [
  {
    id: "lead_existing",
    organizationId: orgId,
    propertyId,
    email: " LawrenceALalonde@GMAIL.com ",
    status: "booked",
    createdAt: "2026-07-15T14:55:00.000Z",
  },
  {
    id: "lead_old",
    organizationId: orgId,
    propertyId,
    email: "lawrencealalonde@gmail.com",
    status: "new",
    createdAt: "2026-07-15T14:40:00.000Z",
  },
];

ok(
  "same email within window reuses",
  findReusablePublicLead(candidates, {
    organizationId: orgId,
    propertyId,
    email: "lawrencealalonde@gmail.com",
    now,
  })?.id === "lead_existing",
);

ok(
  "different email inserts",
  findReusablePublicLead(candidates, {
    organizationId: orgId,
    propertyId,
    email: "other@example.com",
    now,
  }) === null,
);

{
  const reusable = findReusablePublicLead(candidates, {
    organizationId: orgId,
    propertyId,
    email: "lawrencealalonde@gmail.com",
    now,
  });
  const effects = publicLeadSubmitEffects({
    leadReused: reusable != null,
    leadHasShowing: false,
    hasSlot: true,
    outcome: "submitted",
  });
  ok("slot submit uses the reused lead id", reusable?.id === "lead_existing");
  ok("slot submit still attempts booking", effects.attemptBooking === true);
  ok("reused slot submit does not send duplicate new-lead alert", effects.notifyNewLead === false);
}

ok(
  "reused lead with existing showing does not book twice",
  publicLeadSubmitEffects({
    leadReused: true,
    leadHasShowing: true,
    hasSlot: true,
    outcome: "booked",
  }).attemptBooking === false,
);

ok(
  "null email still inserts",
  findReusablePublicLead(candidates, {
    organizationId: orgId,
    propertyId,
    email: null,
    now,
  }) === null,
);
ok("blank email still inserts", normalizePublicLeadDedupEmail("   ") === null);
ok(
  "open reusable statuses include booked",
  PUBLIC_LEAD_DEDUP_OPEN_STATUSES.includes("booked"),
);

const migrationSource = readFileSync(
  new URL("../supabase/migrations/0147_submit_public_lead_dedup.sql", import.meta.url),
  "utf8",
);
ok(
  "migration uses 10 minute dedup window",
  migrationSource.includes("interval '10 minutes'"),
);
ok(
  "migration serializes same email/property submissions",
  migrationSource.includes("pg_advisory_xact_lock"),
);
ok(
  "migration returns lead_reused flag",
  migrationSource.includes("'lead_reused',      v_lead_reused"),
);
ok(
  "migration returns lead_has_showing flag",
  migrationSource.includes("'lead_has_showing', v_lead_has_showing"),
);
ok(
  "migration keeps anonymous inquiries out of dedup",
  migrationSource.includes("v_norm_email := nullif(lower(btrim(p_email)), '')"),
);

// S842a: a returning renter holding a future viewing does not book a second.
{
  const held = publicLeadSubmitEffects({
    leadReused: false,
    leadHasShowing: false,
    hasSlot: true,
    outcome: "submitted",
    heldShowingAt: "2026-11-26T22:15:00.000Z",
  });
  ok("held viewing: no second booking", held.attemptBooking === false);
  ok("held viewing: no auto-reply with a booking link", held.sendAutoReply === false);
  ok("held viewing: team still hears the renter wrote again", held.notifyNewLead === true);
  const none = publicLeadSubmitEffects({
    leadReused: false,
    leadHasShowing: false,
    hasSlot: true,
    outcome: "submitted",
    heldShowingAt: null,
  });
  ok("no held viewing: returning renter still books (0334)", none.attemptBooking === true);
  const actionsSource = readFileSync("app/r/[propertyId]/actions.ts", "utf8");
  ok("action checks a held viewing only for returning renters", actionsSource.includes("lead_returning === true") && actionsSource.includes('.eq("outcome", "scheduled")'));
  ok("action sends a held viewing to the already page", actionsSource.includes("submitted=already&at="));
  const pageSource = readFileSync("app/r/[propertyId]/page.tsx", "utf8");
  ok("page names the held viewing", pageSource.includes("You already have a viewing booked"));
}

console.log(`\npublic-lead-dedup: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
