// S816: signed applications, offers, co-applicants, agent send, credit link.
// Run: npx tsx scripts/test-s816-application-offer.ts
import { readFileSync } from "node:fs";
import {
  applicationConsentText,
  validateTypedSignature,
  applicantStatusLabel,
  normalizeScreeningLink,
} from "../lib/rental-application";
import {
  parseOfferInput,
  dollarsToCents,
  offerTermLines,
  offerStatusLabel,
  canSendNewOffer,
  fmtStartDate,
} from "../lib/application-offer";
import { buildApplicationSummaryModel, renderApplicationSummaryHtml } from "../lib/rental-application-summary";

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

// Consent words name the account and the credit report, and say typing is a signature.
const words = applicationConsentText("Agile Real Estate Group");
ok("consent names org", words.includes("Agile Real Estate Group"));
ok("consent covers credit report", /consumer credit\s+report/.test(words));
ok("consent says typed name is signature", words.includes("electronic signature"));
ok("consent fallback", applicationConsentText(null).includes("the landlord"));
ok("no em dash in consent", !words.includes("—"));

// Typed signature must match the legal name (case, accents, spacing ignored).
ok("sig match", validateTypedSignature("theophilus  sekyi", "Theophilus Sekyi").ok);
ok("sig accents", validateTypedSignature("Rene Dube", "René Dubé").ok);
ok("sig empty", !validateTypedSignature(" ", "A B").ok);
const mm = validateTypedSignature("Someone Else", "Theophilus Sekyi");
ok("sig mismatch", !mm.ok && mm.reason === "signature_mismatch");

ok("label waiting", applicantStatusLabel({ status: "requested" }) === "Waiting to apply");
ok("label signed", applicantStatusLabel({ status: "submitted", signed_at: "2026-11-18T00:00:00Z" }) === "Signed");
ok("label old submitted", applicantStatusLabel({ status: "submitted", signed_at: null }) === "Submitted");
ok("label withdrawn", applicantStatusLabel({ status: "declined" }) === "Withdrawn");

ok("link https kept", normalizeScreeningLink("https://app.frontlobby.com/x") === "https://app.frontlobby.com/x");
ok("link scheme added", normalizeScreeningLink("singlekey.com/apply") === "https://singlekey.com/apply");
ok("link junk", normalizeScreeningLink("not a link") === null);
ok("link js", normalizeScreeningLink("javascript:alert(1)") === null);
ok("link blank", normalizeScreeningLink("  ") === null);

// Offer parsing.
ok("cents", dollarsToCents("$1,250.50") === 125050);
ok("cents blank", dollarsToCents("") === null);
ok("cents bad", Number.isNaN(dollarsToCents("12a") as number));
const good = parseOfferInput({ rent: "1250", deposit: "1250", startDate: "2026-12-01", termMonths: "12", conditions: " ", landlordName: "Noam Muscovitch" });
ok("offer ok", good.ok && good.value.rent_cents === 125000 && good.value.conditions === null && good.value.term_months === 12);
ok("offer no rent", !parseOfferInput({ rent: "", deposit: "", startDate: "2026-12-01", termMonths: "", conditions: "", landlordName: "N M" }).ok);
ok("offer bad date", !parseOfferInput({ rent: "1", deposit: "", startDate: "Dec 1", termMonths: "", conditions: "", landlordName: "N M" }).ok);
ok("offer bad term", !parseOfferInput({ rent: "1", deposit: "", startDate: "2026-12-01", termMonths: "99", conditions: "", landlordName: "N M" }).ok);
ok("offer unsigned", !parseOfferInput({ rent: "1", deposit: "", startDate: "2026-12-01", termMonths: "", conditions: "", landlordName: " " }).ok);
const lines = offerTermLines({ rent_cents: 125000, deposit_cents: 125000, start_date: "2026-12-01", term_months: null });
ok("terms rent", lines[0] === "Rent: $1,250 a month", lines);
ok("terms m2m", lines.includes("Term: month to month"));
ok("start date no drift", fmtStartDate("2026-12-01").includes("1"));
ok("status 1 of 2", offerStatusLabel("sent", 1, 2) === "Sent, 1 of 2 signed");
ok("new offer gating", canSendNewOffer(null) && canSendNewOffer("withdrawn") && !canSendNewOffer("sent") && !canSendNewOffer("accepted"));

// Signed summary shows the signature block and the exact words.
const html = renderApplicationSummaryHtml(
  buildApplicationSummaryModel({
    orgName: "Agile",
    applicantName: "Theophilus Sekyi",
    generatedAtIso: "2026-11-18T00:00:00Z",
    signature: { signedName: "Theophilus Sekyi", signedAtIso: "2026-11-18T01:00:00Z", ip: "1.2.3.4", device: "iPhone", consentText: words },
    creditCheck: "Received",
  }),
);
ok("summary signature", html.includes("Authorization and signature") && html.includes("1.2.3.4") && html.includes("Received"));
ok("summary no paid-by row", !html.includes("Screening paid by"));

// Wiring: every surface uses the shared pieces.
const migration = read("supabase/migrations/0304_application_signature_offers.sql");
ok("0304 keeps old submit", !/drop function/i.test(migration));
ok("0304 RLS offers", migration.includes("application_offers_all") && migration.includes("application_offer_signers_all"));
ok("apply action uses signed RPC", read("app/apply/[token]/actions.ts").includes("submit_rental_application_signed"));
ok("apply page signs", read("app/apply/[token]/page.tsx").includes('name="signed_name"'));
ok("apply page credit step", read("app/apply/[token]/page.tsx").includes("Start my credit check"));
ok("lead action uses starter", read("app/dashboard/leads/actions.ts").includes("startRentalApplication("));
ok("agent action uses starter", read("app/agent/[token]/actions.ts").includes("startRentalApplication("));
ok("agent page button", read("app/agent/[token]/page.tsx").includes("Send them the rental application"));
ok("people page papers", read("app/dashboard/people/[id]/page.tsx").includes("<SignedPapers"));
ok("tenancy page papers", read("app/dashboard/tenancies/[id]/page.tsx").includes("<SignedPapers"));
ok("tenancy prefill from offer", read("app/dashboard/tenancies/new/page.tsx").includes('name="offer_id"'));
ok("tenancy links offer", read("app/dashboard/tenancies/actions.ts").includes('s(formData, "offer_id")'));
ok("org columns", read("lib/org.ts").includes("screening_link_url, screening_link_name"));
ok("settings card", read("app/dashboard/settings/page.tsx").includes('id="credit-check"'));
for (const f of [
  "app/apply/[token]/page.tsx",
  "app/offer/[token]/page.tsx",
  "app/dashboard/leads/[id]/application-card.tsx",
  "lib/application-offer.ts",
  "components/signed-papers.tsx",
]) {
  ok(`no em dash ${f}`, !read(f).includes("—"));
}

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
