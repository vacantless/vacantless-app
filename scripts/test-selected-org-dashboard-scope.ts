// Static coverage for selected-org dashboard reads.
// Run: npx tsx scripts/test-selected-org-dashboard-scope.ts
import { readFileSync } from "fs";
import path from "path";

type FileScopeCheck = {
  file: string;
  tables: string[];
};

const ROOT = process.cwd();
const ORG_EQ = `.eq("organization_id", org.id)`;

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  x ${label}`);
  }
}

function read(file: string): string {
  return readFileSync(path.join(ROOT, file), "utf8");
}

function queryChains(source: string, table: string): string[] {
  const needle = `.from("${table}")`;
  const chains: string[] = [];
  let index = -1;
  while ((index = source.indexOf(needle, index + 1)) !== -1) {
    const nextFrom = source.indexOf(`.from("`, index + needle.length);
    chains.push(source.slice(index, nextFrom === -1 ? source.length : nextFrom));
  }
  return chains;
}

function assertEveryChainContains(file: string, table: string, expected: string) {
  const source = read(file);
  const chains = queryChains(source, table);
  ok(`${file} has ${table} query`, chains.length > 0);
  chains.forEach((chain, idx) => {
    ok(`${file} ${table} query #${idx + 1} is selected-org scoped`, chain.includes(expected));
  });
}

const selectedOrgChecks: FileScopeCheck[] = [
  {
    file: "app/dashboard/page.tsx",
    tables: [
      "showing_agents",
      "user_preferences",
      "showings",
      "leads",
      "properties",
      "availability_rules",
      "tenancies",
      "work_orders",
      "pending_tenant_messages",
      "listing_posts",
      "tenancy_rent_adjustments",
    ],
  },
  {
    file: "app/dashboard/properties/page.tsx",
    tables: ["properties", "leads", "property_photos", "availability_rules"],
  },
  { file: "app/dashboard/leads/page.tsx", tables: ["leads"] },
  {
    file: "app/dashboard/leasing/page.tsx",
    tables: ["leads", "showings", "properties", "leased_outcomes"],
  },
  {
    file: "app/dashboard/showings/page.tsx",
    tables: ["showings", "showing_agents", "email_delivery_events"],
  },
  {
    file: "app/dashboard/availability/page.tsx",
    tables: ["availability_rules", "availability_days_off", "availability_overrides"],
  },
  { file: "app/dashboard/tenancies/page.tsx", tables: ["tenancies"] },
  { file: "app/dashboard/tenancies/watch/page.tsx", tables: ["tenancies"] },
  {
    file: "app/dashboard/tenancies/new/page.tsx",
    tables: ["properties", "leads", "tenancies"],
  },
  {
    file: "app/dashboard/tenancies/message-templates/page.tsx",
    tables: ["tenant_message_templates"],
  },
  {
    file: "app/dashboard/tenancies/[id]/page.tsx",
    tables: [
      "rotessa_accounts",
      "stripe_connect_accounts",
      "tenant_message_templates",
      "leased_outcomes",
      "properties",
      "lease_signers",
      "lease_clauses",
      "lease_clause_versions",
    ],
  },
  {
    file: "app/dashboard/people/page.tsx",
    tables: ["persons", "tenants", "lease_documents", "lease_signers", "documents"],
  },
  {
    file: "app/dashboard/tenants/lease-clauses/page.tsx",
    tables: ["lease_clauses", "lease_clause_versions"],
  },
  { file: "app/dashboard/showing-agents/page.tsx", tables: ["showing_agents"] },
  {
    file: "app/dashboard/money/page.tsx",
    tables: ["stripe_connect_accounts", "rotessa_accounts"],
  },
  {
    file: "app/dashboard/expenses/page.tsx",
    tables: [
      "bank_connections",
      "bank_transactions",
      "properties",
      "categorization_rules",
      "tenancies",
      "etransfer_captures",
      "org_ingest_addresses",
      "rent_payments",
    ],
  },
  {
    file: "app/dashboard/money/reconcile/page.tsx",
    tables: [
      "bank_transactions",
      "expenses",
      "rent_payments",
      "tenancies",
      "categorization_rules",
      "properties",
    ],
  },
  {
    file: "app/dashboard/money/income-statement/page.tsx",
    tables: ["rent_payments", "work_orders", "expenses", "properties"],
  },
  {
    file: "app/dashboard/money/tax-package/page.tsx",
    tables: ["rent_payments", "work_orders", "expenses", "properties"],
  },
  {
    file: "app/dashboard/money/accountant-package/page.tsx",
    tables: ["rent_payments", "work_orders", "expenses"],
  },
  {
    file: "app/dashboard/rent/statement/page.tsx",
    tables: ["rent_payments", "work_orders", "expenses", "properties"],
  },
  {
    file: "app/dashboard/rent/rent-roll/page.tsx",
    tables: ["tenancies", "properties", "work_orders", "expenses"],
  },
  {
    file: "app/dashboard/reports/page.tsx",
    tables: ["leads", "showings", "properties", "feedback"],
  },
  {
    file: "app/dashboard/maintenance/page.tsx",
    tables: [
      "work_orders",
      "trade_contacts",
      "properties",
      "tenancies",
      "incident_reports",
      "work_order_media",
      "incident_media",
      "work_order_dispatches",
      "dispatch_messages",
      "work_order_appointments",
    ],
  },
  {
    file: "app/dashboard/maintenance/notices/page.tsx",
    tables: ["properties", "work_orders", "tenancies", "building_notices"],
  },
  {
    file: "app/dashboard/captures/page.tsx",
    tables: ["org_ingest_addresses", "org_ingest_senders", "documents", "properties"],
  },
  {
    file: "app/dashboard/settings/page.tsx",
    tables: [
      "properties",
      "rotessa_accounts",
      "stripe_connect_accounts",
      "distribution_channel_accounts",
    ],
  },
];

for (const check of selectedOrgChecks) {
  for (const table of check.tables) {
    assertEveryChainContains(check.file, table, ORG_EQ);
  }
}

assertEveryChainContains("app/dashboard/availability/page.tsx", "organizations", `.eq("id", org.id)`);

const nav = read("app/dashboard/dashboard-nav.tsx");
const agent = read("app/agent/page.tsx");
ok("dashboard nav labels /agent as All clients", nav.includes(`label: "All clients"`));
ok("agent heading is All clients", agent.includes(">All clients<"));
ok(
  "agent page still does not import or await getCurrentOrg",
  !agent.includes(`from "@/lib/org"`) && !agent.includes("await getCurrentOrg("),
);
ok("old My Portfolio label removed from checked files", !`${nav}\n${agent}`.includes("My Portfolio"));

console.log(`\nselected-org-dashboard-scope: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
