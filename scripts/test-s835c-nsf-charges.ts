// S835c: NSF charges on a tenancy, and the failed-payment fee as an expense.
// Run: npx tsx scripts/test-s835c-nsf-charges.ts
import { readFileSync } from "node:fs";
import {
  NSF_ADMIN_MAX_CENTS,
  NSF_GUIDANCE,
  NSF_MESSAGES,
  NSF_RULE_URL,
  STRIPE_NSF_FEE_CENTS,
  nsfChargeTotalCents,
  nsfExpenseNote,
  nsfInputValue,
  nsfMoney,
  nsfOwingCents,
  validateNsfCharge,
  type NsfChargeRow,
} from "../lib/nsf-charge";
import { STRIPE_PAD } from "../lib/rent-rail-costs";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error("FAIL:", name);
  }
}

ok("the Stripe fee comes from the one price file", STRIPE_NSF_FEE_CENTS === STRIPE_PAD.failedCents && STRIPE_NSF_FEE_CENTS === 500);
ok("the admin cap is $20", NSF_ADMIN_MAX_CENTS === 2000);

const good = validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "5.00", adminCharge: "20", note: "  Dec  rent " });
ok("a plain charge passes", good.ok && good.value.bankChargeCents === 500 && good.value.adminChargeCents === 2000 && good.value.note === "Dec rent");
ok("an empty admin charge is $0", (() => { const r = validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "$45", adminCharge: "", note: "" }); return r.ok && r.value.adminChargeCents === 0 && r.value.note === null; })());
const over = validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "5", adminCharge: "20.01", note: "" });
ok("an admin charge over $20 is refused", !over.ok && over.code === "admin");
ok("a negative amount is refused", !validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "-5", adminCharge: "", note: "" }).ok);
ok("letters are refused", (() => { const r = validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "five", adminCharge: "", note: "" }); return !r.ok && r.code === "bank"; })());
ok("a typo-sized bank charge is refused", !validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "5000", adminCharge: "", note: "" }).ok);
ok("nothing typed is refused", (() => { const r = validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "", adminCharge: "0", note: "" }); return !r.ok && r.code === "empty"; })());
ok("a bad date is refused", (() => { const r = validateNsfCharge({ incurredOn: "2026-02-30", bankCharge: "5", adminCharge: "", note: "" }); return !r.ok && r.code === "date"; })());
ok("a long note is cut to 200", (() => { const r = validateNsfCharge({ incurredOn: "2026-12-01", bankCharge: "5", adminCharge: "", note: "x".repeat(400) }); return r.ok && r.value.note?.length === 200; })());

const rows: NsfChargeRow[] = [
  { id: "a", incurred_on: "2026-12-01", bank_charge_cents: 500, admin_charge_cents: 2000, note: null, source: "stripe", paid_at: null },
  { id: "b", incurred_on: "2026-11-01", bank_charge_cents: 500, admin_charge_cents: 0, note: null, source: "manual", paid_at: "2026-11-09T00:00:00Z" },
];
ok("a charge totals bank plus admin", nsfChargeTotalCents(rows[0]) === 2500);
ok("only unpaid charges are owing", nsfOwingCents(rows) === 2500 && nsfOwingCents([]) === 0);
ok("money shows dollars", nsfMoney(2500) === "$25" && nsfMoney(1250) === "$12.50" && nsfInputValue(500) === "5.00");
ok("the expense note names the tenant", nsfExpenseNote("Sam Lee") === "Failed rent payment fee, Sam Lee. Recorded by Vacantless." && nsfExpenseNote(null) === "Failed rent payment fee. Recorded by Vacantless.");

const guidance = NSF_GUIDANCE.join(" ");
ok("the note says the cheque wording is not settled for a bank debit", /names cheques/.test(guidance) && /not settled/.test(guidance));
ok("the note keeps NSF charges off an N4", /off an N4/.test(guidance));
ok("the note says it is not legal advice", /not legal advice/.test(guidance));
ok("the note says nothing is taken from the tenant", /never takes it/.test(guidance));
ok("the note never promises the charge is allowed", !/you can charge|you may charge|guaranteed/i.test(guidance));
ok("no em dash in the note or the messages", !/—/.test(guidance + Object.values(NSF_MESSAGES).map((m) => m.text).join(" ")));
ok("the rule link is the Ontario regulation", NSF_RULE_URL === "https://www.ontario.ca/laws/regulation/060516");
for (const code of ["date", "bank", "admin", "empty", "fail", "forbidden", "added", "saved", "paid", "unpaid", "removed"]) {
  ok(`message for ${code}`, !!NSF_MESSAGES[code]);
}

const sql = readFileSync("supabase/migrations/0325_nsf_charges.sql", "utf8");
ok("the table caps the admin charge at $20", /admin_charge_cents[^\n]*<= 2000/.test(sql));
ok("one charge per failed Stripe invoice", /stripe_invoice_id\s+text unique/.test(sql));
ok("the table has row security and the two-step rule", /enable row level security/.test(sql) && /two_step_required/.test(sql));
ok("grants are in the file, service role included", /grant select, insert, update, delete on public\.tenancy_nsf_charges to service_role/.test(sql) && /revoke all on public\.tenancy_nsf_charges from anon/.test(sql));
ok("the expenses table is left alone", !/public\.expenses\b(?!\(id\))/.test(sql.replace(/^--.*$/gm, "")));

const server = readFileSync("lib/nsf-charge-server.ts", "utf8");
ok("the charge is saved before the expense", server.indexOf('from("tenancy_nsf_charges")') < server.indexOf('from("expenses")'));
ok("a repeat of the same invoice records nothing", /23505[\s\S]{0,80}already_recorded/.test(server));
ok("the expense is marked as recorded by Vacantless", /note: nsfExpenseNote\(/.test(server) && /merchant: "Stripe"/.test(server));
ok("a $0 invoice records nothing", /amountDueCents <= 0\) return \{ recorded: false/.test(server));

const hook = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
ok("the webhook records the NSF on a failed payment", /invoice\.payment_failed"\) \{[\s\S]{0,900}recordStripeNsf\(admin/.test(hook));

const actions = readFileSync("app/dashboard/tenancies/nsf-actions.ts", "utf8");
ok("every action checks the rent right", (actions.match(/await guard\(tenancyId\)/g) ?? []).length === 4 && /requireCapability\("manage_rent"/.test(actions));
ok("every write is pinned to the account", (actions.match(/\.eq\("organization_id", org\.id\)/g) ?? []).length >= 4);
ok("the actions never call Stripe or Rotessa", !/getStripe|rotessa/i.test(actions.replace(/\/\/.*$/gm, "")));

const card = readFileSync("components/tenancy-nsf-charges.tsx", "utf8");
ok("the card shows the guidance and the rule link", /NSF_GUIDANCE\.map/.test(card) && /NSF_RULE_URL/.test(card));
ok("the admin box stops at 20", (card.match(/name="admin_charge"[^>]*max="20"/g) ?? []).length === 2);

console.log(`\ns835c nsf charges: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
