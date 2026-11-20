// S824d: "Set up my phone" by QR code. Run: npx tsx scripts/test-s824d-phone-setup.ts
import { readFileSync } from "node:fs";
import {
  PHONE_SETUP_MINUTES,
  PHONE_SETUP_STATE_LINE,
  isPhoneSetupToken,
  phoneKind,
  phoneSetupState,
  phoneSetupUrl,
} from "../lib/phone-setup";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}
const read = (p: string) => readFileSync(p, "utf8");

const T = "0f8fad5b-d9cb-469f-a165-70867728950e";
ok("token ok", isPhoneSetupToken(T));
ok("token upper ok", isPhoneSetupToken(T.toUpperCase()));
ok("token bad", !isPhoneSetupToken("abc") && !isPhoneSetupToken(null) && !isPhoneSetupToken(`${T}x`));
ok("url", phoneSetupUrl("https://app.vacantless.com/", T) === `https://app.vacantless.com/phone/${T}`);
ok("15 minutes", PHONE_SETUP_MINUTES === 15);

ok("iphone", phoneKind("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit") === "iphone");
ok("android", phoneKind("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131") === "android");
ok("computer", phoneKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari") === "other");
ok("no agent", phoneKind(null) === "other");

const now = Date.parse("2026-11-20T12:00:00Z");
ok("ready", phoneSetupState({ expires_at: "2026-11-20T12:10:00Z", used_at: null }, now) === "ready");
ok("used", phoneSetupState({ expires_at: "2026-11-20T12:10:00Z", used_at: "2026-11-20T11:59:00Z" }, now) === "used");
ok("expired", phoneSetupState({ expires_at: "2026-11-20T11:59:59Z", used_at: null }, now) === "expired");
ok("missing", phoneSetupState(null, now) === "missing");
ok("lines say what to do", Object.values(PHONE_SETUP_STATE_LINE).every((l) => l.includes("show a new code")));

// The code is used once: the claim only matches an unused, unexpired row.
const server = read("lib/phone-setup-server.ts");
const claim = server.slice(server.indexOf("export async function claimPhoneSetupLink"));
ok("claim once", claim.includes('.is("used_at", null)') && claim.includes('.gt("expires_at", now)') && claim.includes(".update({ used_at: now })"));
ok("one key per person", server.includes('.update({ revoked_at: now })'));

// Only the server reads the table.
const mig = read("supabase/migrations/0314_phone_setup_links.sql");
ok("table locked", mig.includes("revoke all on public.phone_setup_links from anon, authenticated;"));
ok("service role grant", mig.includes("to service_role;"));
ok("rls on", mig.includes("enable row level security"));
ok("15 min default", mig.includes("interval '15 minutes'"));

// Opening the page changes nothing; only the tap uses the code.
const page = read("app/phone/[token]/page.tsx");
ok("page reads only", page.includes("readPhoneSetupLink(") && !page.includes("claimPhoneSetupLink("));
const act = read("app/phone/[token]/actions.ts");
ok("tap claims first", act.indexOf("claimPhoneSetupLink(") < act.indexOf("generateLink("));
ok("role checked", act.includes('roleCan(role, "manage_leads")'));
ok("opens the account", act.includes("writeSelectedOrgCookie(claim.orgId)"));

// The computer shows the code; the iPhone gets one button.
const card = read("app/dashboard/replies/send-shortcut-card.tsx");
ok("qr on computer", card.includes("Show a code for my phone") && card.includes('device === "other"'));
ok("one tap on iphone", card.includes('device === "iphone" && shortcutUrl') && card.includes("copyWhenReady("));
const actions = read("app/dashboard/replies/actions.ts");
ok("code needs a sign-in that can add renters", actions.includes("export async function showPhoneSetupCode") && actions.includes('roleCan(role, "manage_leads")'));

// S825a: the "key copied" panel survives the sign-in refresh, and the page waits before opening the Shortcut.
const setupUi = read("app/phone/[token]/phone-setup.tsx");
ok("page always renders PhoneSetup", page.includes("stateLine={state === \"ready\" ? null") && !page.includes('state === "ready" ? (\n'));
ok("done panel shows before the used line", setupUi.indexOf("if (done)") < setupUi.indexOf("if (stateLine)"));
ok("shortcut opens after a pause", /setTimeout\(\(\) => \{\s*window\.location\.href = shortcutUrl;/.test(setupUi));

console.log(`\ns824d phone setup: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
