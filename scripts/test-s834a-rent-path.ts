// S834a: the rent-only path, from the S834 stranger walk.
// Run: npx tsx scripts/test-s834a-rent-path.ts
import { readFileSync } from "node:fs";
import { safeTenancyBack, backQuery } from "../lib/rent-return";
import { pickDefaultOpenSection } from "../lib/tenancy-section";
import { decideOnboardingEmail, decideRentOnboardingEmail, RENT_FIRST_STEP_PATH } from "../lib/onboarding-emails";
import { authTrustFor, LEASING_TRUST, RENT_TRUST } from "../components/auth-shell";

let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed++;
    console.log(`FAIL ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");
const ID = "ae4bf209-306a-445f-a5c6-8c60d91a8807";

// 1. Return to the tenancy after Stripe: only our own tenancy path.
ok("tenancy path kept", safeTenancyBack(`/dashboard/tenancies/${ID}`) === `/dashboard/tenancies/${ID}`);
ok("other site refused", safeTenancyBack("https://evil.example/dashboard/tenancies/" + ID) === null);
ok("protocol-relative refused", safeTenancyBack(`//evil.example/dashboard/tenancies/${ID}`) === null);
ok("extra path refused", safeTenancyBack(`/dashboard/tenancies/${ID}/../../x`) === null);
ok("non-string refused", safeTenancyBack(null) === null && safeTenancyBack(5) === null);
ok("back query encoded", backQuery(`/dashboard/tenancies/${ID}`) === `&back=${encodeURIComponent(`/dashboard/tenancies/${ID}`)}`);
ok("bad back gives nothing", backQuery("/dashboard/settings") === "");

// 2. Rent first on the tenancy page when the landlord came for rent.
const base = { tenantCount: 1, leaseDocStatus: "Not started" as const, rentCollectionStatus: "Not set up" as const, rentIncreaseStatus: null };
ok("lease first by default", pickDefaultOpenSection(base) === "lease-document");
ok("rent first on the rent path", pickDefaultOpenSection({ ...base, rentFirst: true }) === "rent-collection");
ok("no tenants still opens tenants", pickDefaultOpenSection({ ...base, tenantCount: 0, rentFirst: true }) === "tenants");
ok(
  "rent set up: no forced open",
  pickDefaultOpenSection({ ...base, rentFirst: true, rentCollectionStatus: "Automatic monthly debit" }) === "lease-document",
);

// 3. Emails: the rent path gets rent wording; the leasing path is unchanged.
const rentWelcome = decideOnboardingEmail({ stage: "signed_up", daysSinceSignup: 0, stepSent: 0, rentOnly: true, tenancies: 0 });
ok("rent welcome subject", rentWelcome?.subject === "Welcome to Vacantless: rent collection in 3 steps");
ok("rent welcome goes to Add tenant", rentWelcome?.actionPath === RENT_FIRST_STEP_PATH && rentWelcome?.actionLabel === "Add your tenant");
ok("rent welcome has no leasing steps", !/Set Live|Marketplace|viewing|photos/i.test(rentWelcome?.body ?? ""));
ok("rent welcome mentions cheques", /No cheques/.test(rentWelcome?.body ?? ""));
ok("rent nudge day 1, no tenant", decideRentOnboardingEmail(1, 1, 0)?.subject === "One step to collecting rent");
ok("no rent nudge once a tenant exists", decideRentOnboardingEmail(1, 1, 1) === null);
ok("no rent nudge on day 0", decideRentOnboardingEmail(1, 0, 0) === null);
ok("no third email", decideRentOnboardingEmail(2, 5, 0) === null);
const leaseWelcome = decideOnboardingEmail({ stage: "signed_up", daysSinceSignup: 0, stepSent: 0 });
ok("leasing welcome unchanged", leaseWelcome?.subject === "Welcome to Vacantless: your first renter in 4 steps");
const allRent = [rentWelcome?.body, rentWelcome?.subject, decideRentOnboardingEmail(1, 1, 0)?.body].join(" ");
ok("no em dash in rent emails", !allRent.includes("—"));

// 4. Sign-up and onboarding proof lines.
ok("rent trust lines", authTrustFor("rent") === RENT_TRUST && RENT_TRUST.includes("Free on every rental"));
ok("leasing trust lines by default", authTrustFor(null) === LEASING_TRUST && authTrustFor("growth") === LEASING_TRUST);

// 5. Wiring, read from the files.
const newPage = read("app/dashboard/tenancies/new/page.tsx");
ok("new tenancy takes a typed address", newPage.includes('name="new_property_address"') && newPage.includes("typeAddress"));
ok("old dead end gone", !newPage.includes("Add the unit first"));
const actions = read("app/dashboard/tenancies/actions.ts");
const createIdx = actions.indexOf("export async function createTenancy");
const insertIdx = actions.indexOf('status: "off_market"', createIdx);
const checkIdx = actions.indexOf("validateTenancyInput(", createIdx);
const rentIdx = actions.indexOf("resolveRentReconciliationFromForm(", createIdx);
ok("unit made only after every check", insertIdx > checkIdx && insertIdx > rentIdx && insertIdx < actions.indexOf("export async function watchLease"));
ok("lands on rent collection", actions.includes('"&rent=1#rent-collection"'));
const settings = read("app/dashboard/settings/page.tsx");
ok("Stripe card before Rotessa", settings.indexOf("<StripeConnectSettingsCard") < settings.indexOf("<RotessaSettingsCard"));
ok("back link after Stripe", settings.includes("Back to your tenant to send the bank link"));
const connect = read("app/dashboard/settings/stripe-connect-actions.ts");
ok("return and refresh carry back", (connect.match(/backQuery\(formData\.get\("back"\)\)/g) ?? []).length === 2);
const section = read("components/tenancy-stripe-rent-section.tsx");
ok("Connect Stripe button on the tenancy", section.includes(">\n            Connect Stripe") || section.includes("Connect Stripe\n"));
ok("method label keeps its capital", !section.includes("method.label.toLowerCase()"));
ok("money page says Starter for the lease reader", read("app/dashboard/money/page.tsx").includes("On Starter and up, drop in the signed lease"));
ok("cost table names the bank check", read("components/rent-cost-table.tsx").includes("STRIPE_PAD.bankCheckCents"));
const signup = read("app/signup/page.tsx");
ok("show password button", signup.includes("setShowPassword") && signup.includes('{showPassword ? "Hide" : "Show"}'));
ok("onboarding hides the renter phone on the rent path", read("app/onboarding/onboarding-form.tsx").includes('planIntent !== "rent"'));
ok("onboarding errors keep the plan", (read("app/onboarding/actions.ts").match(/\$\{keepPlan\}error=/g) ?? []).length === 3);
ok("rent intent stored at sign-up", read("app/onboarding/actions.ts").includes('intent: "rent"'));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
