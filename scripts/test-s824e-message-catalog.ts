// S824e: every message Vacantless sends is on the "Every message we send" page.
// Run: npx tsx scripts/test-s824e-message-catalog.ts
// If this fails, a send was added without a row in lib/message-catalog.ts.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOG_MESSAGES,
  MESSAGE_GROUPS,
  MESSAGE_ORG_SWITCHES,
  AGENT_EVENT_KEYS,
  catalogProblems,
  channelLabel,
  eventGroup,
  isDraftOnlyEvent,
  eventIsOn,
} from "../lib/message-catalog";
import { NOTIFICATION_EVENTS } from "../lib/notifications";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}${extra !== undefined ? ` ${JSON.stringify(extra)}` : ""}`);
  }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.includes(".bak")) out.push(p);
  }
  return out;
}
const files = [...walk("app"), ...walk("lib")];
const src = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

const listed = { send: new Set<string>(), sms: new Set<string>(), notify: new Set<string>(), voice: new Set<string>() };
for (const m of CATALOG_MESSAGES) {
  for (const k of ["send", "sms", "notify", "voice"] as const) for (const v of m.code[k] ?? []) listed[k].add(v);
}

ok("catalog has no problems", catalogProblems().length === 0, catalogProblems());

// 1. Every email send function in lib/email.ts has a row.
const email = src.get("lib/email.ts") ?? "";
const sendFns = [...email.matchAll(/^export async function (send[A-Za-z]+)\(/gm)].map((m) => m[1]).filter((f) => f !== "sendNotificationEmail");
ok("found the email senders", sendFns.length >= 26, sendFns.length);
const missingSend = sendFns.filter((f) => !listed.send.has(f));
ok("every email sender is listed", missingSend.length === 0, missingSend);
const staleSend = [...listed.send].filter((f) => !sendFns.includes(f));
ok("no listed email sender is gone", staleSend.length === 0, staleSend);

// 2. Only lib/email.ts talks to the email service directly.
const directMail = files.filter((f) => f !== "lib/email.ts" && /smtp\/email["`]/.test(src.get(f) ?? ""));
ok("only lib/email.ts sends email", directMail.length === 0, directMail);

// 3. Every file that sends a text has a row.
const smsFiles = files.filter((f) => f !== "lib/sms.ts" && /\bsendSms\(/.test(src.get(f) ?? ""));
const missingSms = smsFiles.filter((f) => !listed.sms.has(f));
ok("every text sender is listed", missingSms.length === 0, missingSms);
const staleSms = [...listed.sms].filter((f) => !smsFiles.includes(f));
ok("no listed text sender is gone", staleSms.length === 0, staleSms);
// Texts only go out through sendSms (one Twilio send path).
const twilioDirect = files.filter((f) => f !== "lib/sms.ts" && /Messages\.json/.test(src.get(f) ?? ""));
ok("only lib/sms.ts sends texts", twilioDirect.length === 0, twilioDirect);

// 4. Every direct use of the generic email sender has a row (events go through notifications-server).
const notifyFiles = files.filter(
  (f) => f !== "lib/email.ts" && f !== "lib/notifications-server.ts" && /\bsendNotificationEmail\(/.test(src.get(f) ?? ""),
);
const missingNotify = notifyFiles.filter((f) => !listed.notify.has(f));
ok("every direct email is listed", missingNotify.length === 0, missingNotify);
const staleNotify = [...listed.notify].filter((f) => !notifyFiles.includes(f));
ok("no listed direct email is gone", staleNotify.length === 0, staleNotify);

// 5. Spoken call answers.
const voiceFiles = files.filter((f) => /<Say>/.test(src.get(f) ?? ""));
const missingVoice = voiceFiles.filter((f) => !listed.voice.has(f));
ok("every call answer is listed", missingVoice.length === 0, missingVoice);

// 6. The notification events: every one lands in a group, and the agent list is real.
const keys = new Set(NOTIFICATION_EVENTS.map((e) => e.key));
ok("58 or more events", NOTIFICATION_EVENTS.length >= 58, NOTIFICATION_EVENTS.length);
ok("agent keys exist", [...AGENT_EVENT_KEYS].every((k) => keys.has(k)), [...AGENT_EVENT_KEYS].filter((k) => !keys.has(k)));
ok("events have a description to show", NOTIFICATION_EVENTS.every((e) => e.description.trim().length > 0));
ok("assigned viewing goes to agents", eventGroup({ key: "leasing.showing_assigned", audience: "operator" }) === "agents");
ok("tenant events go to tenants", eventGroup({ key: "x", audience: "tenant" }) === "tenants");
ok("new inquiry goes to you", eventGroup({ key: "leasing.new_lead", audience: "operator" }) === "you");
ok("seasonal is a draft", isDraftOnlyEvent("leasing.seasonal_furnace_filter") && !isDraftOnlyEvent("leasing.new_lead"));

// 7. Switches are real account columns the page may write.
const migText = readdirSync("supabase/migrations").map((f) => readFileSync(join("supabase/migrations", f), "utf8")).join("\n");
for (const c of MESSAGE_ORG_SWITCHES) ok(`switch column ${c} exists`, migText.includes(c));
ok("every switch row names a known column", CATALOG_MESSAGES.every((m) => m.control.type !== "switch" || (MESSAGE_ORG_SWITCHES as readonly string[]).includes(m.control.column)));

// Live on/off follows the senders' rules.
ok("plain event on with no row", eventIsOn({ key: "leasing.new_lead" }, null) === true);
ok("plain event off with a row", eventIsOn({ key: "leasing.new_lead" }, { enabled: false }) === false);
ok("listing health off with no row", eventIsOn({ key: "leasing.listing_health" }, null) === false);
ok("draft off with no row", eventIsOn({ key: "x", sendMode: "approve_to_send" }, null) === false);
ok("draft on with a row", eventIsOn({ key: "x", sendMode: "approve_to_send" }, { enabled: true }) === true);

// 8. Labels.
ok("channel label", channelLabel(["email", "text"]) === "Email and Text");
ok("eight groups", MESSAGE_GROUPS.length === 8);

// 9. The page reads the catalog and every event, and the switch action checks the column list.
const page = readFileSync("app/dashboard/automations/every-message/page.tsx", "utf8");
ok("page lists catalog", page.includes("CATALOG_MESSAGES"));
ok("page lists events", page.includes("activeNotificationEvents()"));
const act = readFileSync("app/dashboard/automations/every-message/actions.ts", "utf8");
ok("switch action is limited to the list", act.includes("MESSAGE_ORG_SWITCHES") && act.includes('currentUserCan("manage_settings")'));

console.log(`\ns824e message catalog: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
