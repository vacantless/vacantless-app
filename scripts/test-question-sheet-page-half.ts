// Source-inspection + loader tests for the Slice 2 page half (SPEC-S688 Slice 2
// sections 4.2 + 4.4, S692). Run: npx tsx scripts/test-question-sheet-page-half.ts
import { readFileSync } from "node:fs";
import { isMissingColumnError } from "../lib/question-sheet-load";
import { QUESTION_KEYS } from "../lib/question-sheet";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

// --- missing-column detection (pre-0226 database) ---------------------------------
ok("42703 is a missing column", isMissingColumnError({ code: "42703", message: "column properties.question_sheet_completed_at does not exist" }));
ok("PGRST204 is a missing column", isMissingColumnError({ code: "PGRST204", message: "Could not find the 'for_rent_by' column of 'organizations' in the schema cache" }));
ok("message-only match", isMissingColumnError({ message: "column \"question_sheet_channels\" does not exist" }));
ok("RLS denial is not a missing column", !isMissingColumnError({ code: "42501", message: "permission denied for table properties" }));
ok("network error is not a missing column", !isMissingColumnError({ message: "fetch failed" }));
ok("null is not a missing column", !isMissingColumnError(null));

// --- the loader reads the 0226 columns in their own queries -------------------------
const loader = readFileSync("lib/question-sheet-load.ts", "utf8");
ok("loader: main property select never names a 0226 column", !/PROPERTY_COLUMNS\s*=\s*"[^"]*question_sheet/.test(loader));
ok("loader: question_sheet columns read in a separate select", loader.includes('.select("question_sheet_completed_at, question_sheet_channels")'));
ok("loader: org for_rent_by read in a separate select", loader.includes('.select("for_rent_by")'));
ok("loader: column_missing is its own reason", (loader.match(/reason: "column_missing"/g) ?? []).length >= 2);
ok("loader: resolves building over org before the unit (policy inheritance)", loader.includes("resolveBuildingProfile(buildingProfile, orgProfile)"));

// --- add-details page: sheet only with the flag, an owned property and 0226 -----------
const page = readFileSync("app/dashboard/add-details/page.tsx", "utf8");
ok("add-details: gated on the wizard flag", page.includes("if (ownedPropertyId && distributionWizardEnabled())"));
ok("add-details: gated on loader availability", page.includes("if (loaded.available) sheet = loaded.sheet;"));
ok("add-details: cards still render when there is no sheet", page.includes("{sheet && sheetCopy && ownedPropertyId ? (") && page.includes("STAGE2_METHODS.map"));
ok("add-details: Next stays inert while required answers remain", page.includes("nextDisabled={sheet != null && sheet.requiredRemaining > 0}"));
ok("add-details: org-scope questions read-only without manage_settings", page.includes('callerCanEditOrg: roleCan(role, "manage_settings")'));

// --- property page: sheet facts only once the sheet exists -----------------------------
const propertyPage = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
ok("property page: sheet facts gated on the wizard flag", propertyPage.includes("if (org && distributionWizardEnabled()) {") && propertyPage.includes("questionSheetFieldFacts(loadedSheet.input)"));
ok("property page: S691 facts stand when the loader is unavailable", propertyPage.includes("let sheetAwareFacts: ListingPacketFieldFacts = listingPacketFacts;"));
ok("property page: readiness built from the sheet-aware facts", propertyPage.includes("fieldFacts: sheetAwareFacts,"));

// --- the action: result object, no redirect, org write only with manage_settings ---------
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
const actionStart = actions.indexOf("export async function saveQuestionSheet(");
const actionBody = actions.slice(actionStart);
ok("action: exists", actionStart > 0);
ok("action: never redirects", !/\bredirect\(/.test(actionBody));
ok("action: refuses without manage_properties", actionBody.includes('roleCan(role, "manage_properties")'));
ok("action: org-scope writes follow manage_settings", actionBody.includes('roleCan(role, "manage_settings")'));
ok("action: pre-0226 answers sheet_unavailable, not a throw", actionBody.includes('reason: loaded.reason === "not_found" ? "not_found" : "sheet_unavailable"'));
ok("action: property update scoped to the org", actionBody.includes('.eq("organization_id", org.id)'));

// --- the form: uncontrolled, channels carried, utilities marker ----------------------------
const form = readFileSync("app/dashboard/add-details/question-sheet-form.tsx", "utf8");
ok("form: sends the sheet's channels with the answers", form.includes('formData.append("channels", channel)'));
ok("form: utilities are tri-state selects, never a bare checkbox group", form.includes('name={`utilities_${o.value}`}') && !form.includes("utilities_answered"));
ok("form: submit guard survives an async action (no useTransition)", form.includes("inFlight.current") && !form.includes("useTransition("));
ok("form: date min comes from the server", form.includes("todayIso: string") && !form.includes("new Date()"));
ok("form: a complete sheet shows the done line and no Save button", form.includes("if (sheet.questions.length === 0) {"));
ok("form: refreshes the server render after a save", form.includes("router.refresh()"));
ok("form: photos row links to the property page photos", form.includes("#property-photos"));

// --- copy: en and fr carry every sheet key and every question label -----------------------
const en = JSON.parse(readFileSync("messages/en.json", "utf8")) as { stage2: { sheet: Record<string, unknown> } };
const fr = JSON.parse(readFileSync("messages/fr.json", "utf8")) as { stage2: { sheet: Record<string, unknown> } };
const enKeys = Object.keys(en.stage2.sheet).sort();
const frKeys = Object.keys(fr.stage2.sheet).sort();
ok("copy: en and fr sheet keys match", JSON.stringify(enKeys) === JSON.stringify(frKeys));
const enQ = en.stage2.sheet.q as Record<string, string>;
const frQ = fr.stage2.sheet.q as Record<string, string>;
ok("copy: every question key has an en label", QUESTION_KEYS.every((k) => typeof enQ[k] === "string" && enQ[k].length > 0));
ok("copy: every question key has a fr label", QUESTION_KEYS.every((k) => typeof frQ[k] === "string" && frQ[k].length > 0));
ok("copy: no em dashes", !/—/.test(JSON.stringify(en.stage2.sheet)) && !/—/.test(JSON.stringify(fr.stage2.sheet)));

console.log(`\nquestion-sheet-page-half: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
