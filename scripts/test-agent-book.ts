// Unit tests for the agent book overview roll-up (Tier 1 A).
// Run: npx tsx scripts/test-agent-book.ts
import {
  buildAgentBookRows,
  groupAgentBookByOrg,
  AGENT_BOOK_PRIORITY,
  type AgentBookInput,
  type AgentBookUnitInput,
} from "../lib/agent-book";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const P_A1 = "11111111-1111-1111-1111-111111111111";
const P_A2 = "22222222-2222-2222-2222-222222222222";
const P_A3 = "33333333-3333-3333-3333-333333333333";
const P_B1 = "44444444-4444-4444-4444-444444444444";
const P_B2 = "55555555-5555-5555-5555-555555555555";

function unit(over: Partial<AgentBookUnitInput> & { orgId: string; propertyId: string; address: string }): AgentBookUnitInput {
  return {
    unitLabel: null,
    status: "available",
    rentCents: 200000,
    beds: 2,
    baths: 1,
    photoCount: 2,
    listingPostCount: 0,
    hasAvailability: true,
    leadStatuses: [],
    tenancyId: null,
    tenancyStatus: null,
    needsOperatorCount: 0,
    ...over,
  };
}

const input: AgentBookInput = {
  orgs: [
    { id: ORG_A, name: "Alpha Realty" },
    { id: ORG_B, name: "Beta Holdings" },
  ],
  units: [
    // A live unit with two fresh inquiries -> priority 0 (needs you most).
    unit({ orgId: ORG_A, propertyId: P_A1, address: "1 Alpha St", leadStatuses: ["new", "replied"] }),
    // A draft with no rent yet -> setup gap (priority 2).
    unit({ orgId: ORG_A, propertyId: P_A2, address: "2 Alpha Ave", status: "draft", rentCents: null }),
    // Set up + has a photo but paused, not live -> notLiveButShould (priority 2).
    unit({ orgId: ORG_A, propertyId: P_A3, address: "3 Alpha Way", status: "paused", photoCount: 1 }),
    // Live, no inquiries, publish items stuck on the operator -> priority 1.
    unit({ orgId: ORG_B, propertyId: P_B1, address: "1 Beta Rd", needsOperatorCount: 3 }),
    // Fully tenanted -> no current step, quiet (priority 4).
    unit({ orgId: ORG_B, propertyId: P_B2, address: "2 Beta Blvd", status: "leased", photoCount: 0, tenancyId: "t-1", tenancyStatus: "active" }),
  ],
};

const rows = buildAgentBookRows(input);

ok("emits one row per unit", rows.length === 5);

// --- sort order: needs-you-most first, then org name, then address ---------
ok("row 0 is the new-inquiry unit (priority 0)", rows[0]?.propertyId === P_A1 && rows[0]?.priority === AGENT_BOOK_PRIORITY.newLeads);
ok("row 1 is the needs-operator unit (priority 1)", rows[1]?.propertyId === P_B1 && rows[1]?.priority === AGENT_BOOK_PRIORITY.needsOperator);
ok("row 2 is the setup-gap unit (priority 2, address tiebreak first)", rows[2]?.propertyId === P_A2 && rows[2]?.priority === AGENT_BOOK_PRIORITY.setupOrMarket);
ok("row 3 is the not-live-but-should unit (priority 2, later address)", rows[3]?.propertyId === P_A3);
ok("row 4 is the tenanted unit (priority 4, last)", rows[4]?.propertyId === P_B2 && rows[4]?.priority === AGENT_BOOK_PRIORITY.quiet);

// --- flag counts -----------------------------------------------------------
ok("new-inquiry unit counts 2 new leads", rows[0]?.flags.newLeadCount === 2);
ok("needs-operator unit carries the operator count", rows[1]?.flags.needsOperatorCount === 3);
ok("paused set-up unit flags notLiveButShould", rows[3]?.flags.notLiveButShould === true);
ok("leased unit does not flag photos missing", rows[4]?.flags.photosMissing === false);

// --- stage + next-action text (reused engines) -----------------------------
ok("new-inquiry unit stage = Viewings", rows[0]?.stage === "Viewings");
ok("new-inquiry unit next action routes to viewings", rows[0]?.nextAction === "Go to viewings");
ok("needs-operator unit stage = Inquiries", rows[1]?.stage === "Inquiries");
ok("needs-operator unit next action = marketing checklist", rows[1]?.nextAction === "Open marketing checklist");
ok("setup-gap unit stage = Unit details", rows[2]?.stage === "Unit details");
ok("setup-gap unit next action = Add property details", rows[2]?.nextAction === "Add property details");
ok("tenanted unit stage = Tenanted", rows[4]?.stage === "Tenanted");
ok("tenanted unit has no next action", rows[4]?.nextAction === "");

// --- grouping by org -------------------------------------------------------
const groups = groupAgentBookByOrg(rows);
ok("groups into 2 orgs", groups.length === 2);
ok("orgs ordered by name (Alpha first)", groups[0]?.orgName === "Alpha Realty" && groups[1]?.orgName === "Beta Holdings");
ok("Alpha group has 3 units", groups[0]?.rows.length === 3);
ok("Beta group has 2 units", groups[1]?.rows.length === 2);
ok("needs-you-most order preserved within a group", groups[0]?.rows[0]?.propertyId === P_A1);

// --- unitLabel fallback ----------------------------------------------------
const labelled = buildAgentBookRows({
  orgs: [{ id: ORG_A, name: "Alpha Realty" }],
  units: [unit({ orgId: ORG_A, propertyId: P_A1, address: "1 Alpha St", unitLabel: "Unit 4" })],
});
ok("uses unitLabel when present", labelled[0]?.unitLabel === "Unit 4");
const unlabelled = buildAgentBookRows({
  orgs: [{ id: ORG_A, name: "Alpha Realty" }],
  units: [unit({ orgId: ORG_A, propertyId: P_A1, address: "1 Alpha St", unitLabel: "  " })],
});
ok("falls back to address when unitLabel is blank", unlabelled[0]?.unitLabel === "1 Alpha St");

console.log(
  `\ntest-agent-book: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
