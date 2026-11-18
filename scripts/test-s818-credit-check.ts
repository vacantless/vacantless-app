// S818: one credit check per vacancy; free LTB order search on Ontario rentals.
// Run: npx tsx scripts/test-s818-credit-check.ts
import { readFileSync } from "node:fs";
import {
  isOntarioRental,
  ltbSearchUrl,
  CREDIT_CHECK_ONE_LINE,
  CREDIT_CHECK_ONTARIO_LINE,
  LTB_CHECK_LINE,
} from "../lib/credit-check";
import { creditCheckInviteHtml } from "../lib/email";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`, extra === undefined ? "" : JSON.stringify(extra));
  }
}
const read = (p: string) => readFileSync(p, "utf8");

// Ontario detection.
ok("ON postal N8Y", isOntarioRental({ postal_code: "N8Y 3B4" }));
ok("ON postal no space", isOntarioRental({ postal_code: "m5v2t6" }));
ok("BC postal", !isOntarioRental({ postal_code: "V6B 1A1" }));
ok("address , ON", isOntarioRental({ address: "833 Pillette Rd, Windsor, ON" }));
ok("address Ontario", isOntarioRental({ address: "1 Main St, Ottawa, Ontario" }));
ok("address postal in text", isOntarioRental({ address: "1551 Assumption St Windsor N9A 3K8" }));
ok("address AB", !isOntarioRental({ address: "10 Ave SW, Calgary, AB T2P 1J9" }));
ok("null", !isOntarioRental(null));
ok("empty", !isOntarioRental({}));

// LTB search link.
const u = ltbSearchUrl("Jane Smith") ?? "";
ok("ltb host", u.startsWith("https://www.canlii.org/en/#search/"));
ok("ltb tribunal filter", u.includes("ccId=onltb"));
ok("ltb quoted name", u.includes(encodeURIComponent('"Jane Smith"')));
ok("ltb strips quotes", !(ltbSearchUrl('Ja"ne Smith') ?? "").includes(encodeURIComponent('Ja"ne')));
ok("ltb too short", ltbSearchUrl("Al") === null && ltbSearchUrl(null) === null);

// Copy: the rule, never a fee on the applicant, no em dashes.
for (const [k, v] of Object.entries({ CREDIT_CHECK_ONE_LINE, CREDIT_CHECK_ONTARIO_LINE, LTB_CHECK_LINE })) {
  ok(`${k} no em dash`, !v.includes("—"));
}
ok("ontario line says landlord pays", /you pay/i.test(CREDIT_CHECK_ONTARIO_LINE) && /can't charge the applicant/i.test(CREDIT_CHECK_ONTARIO_LINE));
ok("ltb line is honest about coverage", /published/i.test(LTB_CHECK_LINE));

// Email.
const html = creditCheckInviteHtml({
  applicant_name: "Jane Smith",
  applicant_email: "j@example.com",
  org_name: "Lakeview Rentals",
  brand_color: null,
  logo_url: null,
  reply_to_email: null,
  property_address: "88 Lakeview",
  screening_name: "FrontLobby",
  apply_url: "https://app.vacantless.com/apply/abc",
});
ok("email names company", html.includes("FrontLobby"));
ok("email links apply page", html.includes("https://app.vacantless.com/apply/abc"));
ok("email no fee words", !/\b(fee|pay for)\b/i.test(html));
ok("email no em dash", !html.includes("—"));

// Wiring.
const apply = read("app/apply/[token]/page.tsx");
ok("apply step gated on asked", apply.includes('app.screening_link_url && app.credit_check_status === "asked"'));
const mig = read("supabase/migrations/0308_credit_check_on_ask.sql");
ok("0308 withholds link until asked", mig.includes("case when v_asked then v_org.screening_link_url end"));
ok("0308 returns status", mig.includes("'credit_check_status', v_app.credit_check_status"));
ok("0308 grant", mig.includes("grant execute on function public.get_rental_application_by_token(uuid) to anon, authenticated"));
const act = read("app/dashboard/leads/actions.ts");
ok("ask sends the email", act.includes("sendCreditCheckInvite({"));
ok("ask only on first ask of a signed applicant", act.includes('row.credit_check_status !== "asked" && row.status !== "requested"'));
const card = read("app/dashboard/leads/[id]/application-card.tsx");
ok("card LTB button", card.includes("Check LTB orders (free)") && card.includes("p.ontario && ltbSearchUrl"));
ok("card ask button", card.includes("Ask for credit check"));
ok("card rule lines", card.includes("CREDIT_CHECK_ONE_LINE") && card.includes("CREDIT_CHECK_ONTARIO_LINE"));
ok("card banners", card.includes("credit_emailed:") && card.includes("credit_copy:") && card.includes("credit_nolink:"));
ok("card no longer says straight after signing", !card.includes("go straight to your"));
const lead = read("app/dashboard/leads/[id]/page.tsx");
ok("lead page passes ontario", lead.includes("ontario={isOntarioRental(l.property)}") && lead.includes("postal_code, status, rent_cents"));
const settings = read("app/dashboard/settings/page.tsx");
ok("settings rule lines", settings.includes("{CREDIT_CHECK_ONTARIO_LINE}") && settings.includes("{LTB_CHECK_LINE}"));
ok("settings no longer says straight after signing", !settings.includes("they go straight to it"));
const home = read("app/page.tsx");
ok("homepage one check line", home.includes("Only the applicant you pick gets your link"));
ok("homepage ltb line", home.includes("Landlord and Tenant Board orders free"));
ok("homepage old line gone", !home.includes("After signing, renters go straight to your link."));

console.log(`test-s818-credit-check: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
