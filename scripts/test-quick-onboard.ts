import {
  buildQuickOnboardFirstTouchDraft,
  quickOnboardDedupeKey,
  quickOnboardSlugBase,
  validateQuickOnboardInput,
  QUICK_ONBOARD_FIRST_TOUCH_EVENT,
} from "../lib/quick-onboard";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const valid = validateQuickOnboardInput({
  landlordName: " David Harel ",
  landlordEmail: " DAVID@Example.CA ",
  propertyAddress: " 18 Shorncliffe Ave Unit 3 ",
  occupancyDate: "2026-08-01",
  rent: "2,100.50",
  marketingConsent: true,
});
ok("valid input normalizes values", valid.ok && valid.value.landlordEmail === "david@example.ca");
ok("valid input parses rent cents", valid.ok && valid.value.rentCents === 210050);
ok("valid input preserves consent", valid.ok && valid.value.marketingConsent === true);

const noRent = validateQuickOnboardInput({
  landlordName: "David Harel",
  landlordEmail: "david@example.ca",
  propertyAddress: "18 Shorncliffe Ave Unit 3",
  occupancyDate: "2026-08-01",
  rent: "",
  marketingConsent: false,
});
ok("blank rent is valid no-baseline mode", noRent.ok && noRent.value.rentCents === null);

ok(
  "bad email rejected",
  validateQuickOnboardInput({
    landlordName: "David",
    landlordEmail: "not an email",
    propertyAddress: "18 Shorncliffe",
    occupancyDate: "2026-08-01",
    rent: "",
    marketingConsent: false,
  }).ok === false,
);
ok(
  "bad date rejected",
  validateQuickOnboardInput({
    landlordName: "David",
    landlordEmail: "david@example.ca",
    propertyAddress: "18 Shorncliffe",
    occupancyDate: "08/01/2026",
    rent: "",
    marketingConsent: false,
  }).ok === false,
);
ok(
  "negative rent rejected",
  validateQuickOnboardInput({
    landlordName: "David",
    landlordEmail: "david@example.ca",
    propertyAddress: "18 Shorncliffe",
    occupancyDate: "2026-08-01",
    rent: "-50",
    marketingConsent: false,
  }).ok === false,
);

ok(
  "slug base uses name and email local part",
  quickOnboardSlugBase("David Harel", "David.Harel@example.ca") ===
    "david-harel-david-harel",
);
ok(
  "dedupe key is stable",
  quickOnboardDedupeKey("tenancy-123") ===
    `${QUICK_ONBOARD_FIRST_TOUCH_EVENT}:tenancy-123`,
);

const draft = buildQuickOnboardFirstTouchDraft({
  landlordName: "David Harel",
  propertyAddress: "18 Shorncliffe Ave Unit 3",
  rentCents: 210000,
  confirmUrl: "https://app.vacantless.com/confirm-rent/token-123",
});
ok("first-touch draft subject names the property", draft.subject.includes("18 Shorncliffe"));
ok("first-touch draft body includes the confirm link", draft.body.includes("token-123"));
ok("first-touch draft body includes known rent", draft.body.includes("$2,100/month"));
ok("first-touch draft copy has no em dash", !draft.subject.includes("—") && !draft.body.includes("—"));

const noBaselineDraft = buildQuickOnboardFirstTouchDraft({
  landlordName: "David Harel",
  propertyAddress: "18 Shorncliffe Ave Unit 3",
  rentCents: null,
  confirmUrl: "https://app.vacantless.com/confirm-rent/token-123",
});
ok("no-baseline draft asks for current rent", noBaselineDraft.body.includes("not on file yet"));

console.log(
  `\ntest-quick-onboard: ${passed} passed, ${failed} failed (${passed + failed} total)`,
);
if (failed > 0) process.exit(1);
