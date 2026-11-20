// S816l: "Send to Vacantless" pure rules.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  hashSendKey,
  makeSendKey,
  nextWindow,
  planSend,
  readSendKey,
  sendKeyHint,
  sendResultLine,
  sendSource,
  SEND_HOURLY_LIMIT,
  SEND_ERRORS,
  sniffImageType,
} from "../lib/send-shortcut";
import { SEND_SHORTCUT_FILE, SEND_SHORTCUT_STEPS } from "../lib/send-shortcut-copy";
import { answerKeyForQuestion, replySiteKey, shortcutReply, shortcutReplyLine } from "../lib/send-shortcut";
import { buildReplyKitCards } from "../lib/reply-kit";

let n = 0;
const ok = (c: unknown, m: string) => {
  assert.ok(c, m);
  n++;
};

const k = makeSendKey();
ok(k.startsWith("vl_") && k.length === 35, "key shape");
ok(makeSendKey() !== k, "keys differ");
ok(hashSendKey(k) === hashSendKey(` ${k} `), "hash trims");
ok(hashSendKey(k).length === 64 && !hashSendKey(k).includes(k), "hash is sha256 hex, not the key");
ok(sendKeyHint(k) === k.slice(-4), "hint is last 4");

ok(readSendKey(`Bearer ${k}`, null) === k, "header key");
ok(readSendKey(null, k) === k, "form key");
ok(readSendKey("Bearer nope", null) === null, "wrong prefix refused");
ok(readSendKey(null, "vl_short") === null, "short refused");
ok(readSendKey(null, "") === null, "empty refused");

const now = new Date("2026-11-18T15:00:00Z");
let w = nextWindow(null, 0, now);
ok(w.allowed && w.uses === 1, "first use opens a window");
w = nextWindow("2026-11-18T14:30:00Z", 5, now);
ok(w.allowed && w.uses === 6 && w.windowStart === "2026-11-18T14:30:00.000Z", "counts in the hour");
w = nextWindow("2026-11-18T14:30:00Z", SEND_HOURLY_LIMIT, now);
ok(!w.allowed, "limit hit");
w = nextWindow("2026-11-18T13:59:00Z", SEND_HOURLY_LIMIT, now);
ok(w.allowed && w.uses === 1, "new hour resets");

ok(sendSource("Facebook Marketplace") === "Facebook Marketplace", "marketplace");
ok(sendSource("Messenger") === "Facebook Marketplace", "messenger counts as Marketplace");
ok(sendSource("Kijiji") === "Kijiji", "kijiji");
ok(sendSource("Text message") === "Text message (screenshot)", "texts");
ok(sendSource(null) === "Screenshot", "unknown");

ok(planSend({ name: null, email: null, phone: null, rentalId: null }).kind === "no_renter", "nothing");
ok(planSend({ name: "Maria", email: null, phone: null, rentalId: "r1" }).kind === "chat_name", "name and rental");
ok(planSend({ name: "Maria", email: null, phone: null, rentalId: null }).kind === "name_no_rental", "name only");
const c = planSend({ name: null, email: "a@b.ca", phone: null, rentalId: null });
ok(c.kind === "contact" && c.propertyId === null, "contact without rental");

const lines = [
  sendResultLine({ outcome: "saved", name: "Maria", rental: "833 Pillette Rd, Unit 3" }),
  sendResultLine({ outcome: "saved", name: "Maria" }),
  sendResultLine({ outcome: "exists", name: "Maria", rental: "833 Pillette Rd, Unit 3" }),
  sendResultLine({ outcome: "not_available", rental: "Unit 9" }),
  sendResultLine({ outcome: "no_renter" }),
  sendResultLine({ outcome: "unreadable" }),
  sendResultLine({ outcome: "failed" }),
  ...Object.values(SEND_ERRORS),
  ...SEND_SHORTCUT_STEPS,
];
ok(lines[0] === "Saved Maria for 833 Pillette Rd, Unit 3 in Renters.", "saved line");
ok(lines[1].includes("pick it on their page"), "no rental line");
for (const l of lines) ok(!/[—–]/.test(l), `no dashes: ${l}`);
ok(SEND_SHORTCUT_STEPS.some((s) => s.includes("{URL}")), "steps carry the address");

ok(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff])) === "image/jpeg", "sniff jpeg");
ok(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) === "image/png", "sniff png");
ok(sniffImageType(new Uint8Array([1, 2, 3])) === null, "sniff other");

// Wiring: route, migration, card.
const route = readFileSync("app/api/shortcut/renter/route.ts", "utf8");
ok(route.includes("checkSendKey") && route.includes("checkScreenshot"), "route checks key and picture");
const mig = readFileSync("supabase/migrations/0306_capture_keys.sql", "utf8");
ok(mig.includes("key_hash text not null unique") && mig.includes("enable row level security"), "migration stores hash with RLS");
ok(mig.includes("revoke all on public.capture_keys from anon"), "anon locked out");
const page = readFileSync("app/dashboard/replies/page.tsx", "utf8");
ok(page.includes("<SendShortcutCard"), "card on Quick replies");
const server = readFileSync("lib/send-shortcut-server.ts", "utf8");
ok(server.includes('roleCan(role, "manage_leads")'), "role checked on every send");

// S817: the shared file is named with spaces so iPhone shows "Send to Vacantless".
ok(decodeURIComponent(SEND_SHORTCUT_FILE) === "/shortcut/Send to Vacantless.shortcut", "shortcut file named with spaces");
// S817b: the Shortcut copies the Quick replies text.
ok(answerKeyForQuestion("Is this still available?") === null, "still available = first reply");
ok(answerKeyForQuestion("Is this 1 bed 1 bath apartment still available?") === null, "Victor's question = first reply");
ok(answerKeyForQuestion("") === null, "no question = first reply");
ok(answerKeyForQuestion("Are pets allowed? I have a cat") === "pets", "pets");
ok(answerKeyForQuestion("Is hydro included?") === "utilities", "utilities");
ok(answerKeyForQuestion("is there parking") === "parking", "parking");
ok(answerKeyForQuestion("Laundry in building?") === "laundry", "laundry");
ok(answerKeyForQuestion("does it have A/C") === "ac", "ac");
ok(answerKeyForQuestion("When can I move in?") === "move_in", "move in");
ok(answerKeyForQuestion("May I see it this week?") === null, "May the word is not a month");
ok(replySiteKey("Facebook Marketplace") === "facebook" && replySiteKey("Messenger") === "facebook", "facebook site");
ok(replySiteKey("Kijiji") === "kijiji" && replySiteKey("texts") === "direct", "other sites");
{
  const cards = buildReplyKitCards({
    appUrl: "https://app.vacantless.com",
    properties: [{ id: "p1", address: "1551 Assumption St, Unit 9, Windsor, ON", rent_cents: 109500, beds: 1, baths: 1, status: "available", archived_at: null }],
    posts: [{ id: "post1", property_id: "p1", portal: "facebook", status: "live" }],
    timesByProperty: new Map([["p1", { hasViewingTimes: true, nextTimes: null }]]),
    featuresByProperty: new Map([["p1", { pets_cats: false, pets_dogs: false, heat_included: true, hydro_included: false }]]),
  });
  const card = cards[0];
  const first = shortcutReply({ card, site: "Facebook Marketplace", question: "Is this still available?", phone: null, renterName: "Victor" });
  ok(first.why === "ok" && !!first.text && first.text.includes("Victor") && first.text.includes("post1"), "first reply uses the Marketplace link and the name");
  const pets = shortcutReply({ card, site: "Facebook Marketplace", question: "Do you allow dogs?", phone: null, renterName: "Victor" });
  ok(pets.why === "ok" && !!pets.text && /pets are not allowed/.test(pets.text), "pets answer from the record");
  const park = shortcutReply({ card, site: "Facebook Marketplace", question: "Is there parking?", phone: null, renterName: "Victor" });
  ok(park.text === null && park.why === "no_answer", "no parking on file = nothing copied, never a guess");
  const none = shortcutReply({ card: null, site: "Facebook Marketplace", question: "", phone: null, renterName: "Victor" });
  ok(none.text === null && none.why === "no_rental", "no rental = nothing copied");
  const text = shortcutReply({ card, site: "texts", question: "", phone: null, renterName: null });
  ok(!!text.text && !text.text.includes("post1"), "a text chat gets the plain link");
  ok(shortcutReplyLine("ok").includes("copied"), "copied line");
}
{
  const routeSrc = readFileSync("app/api/shortcut/renter/route.ts", "utf8");
  ok(routeSrc.includes('get("v") === "2"') && routeSrc.includes("sayJson"), "v=2 answers in JSON");
  ok(routeSrc.includes("if (!v2) return say("), "older Shortcuts keep the plain line");
  const builder = readFileSync("scripts/build-send-shortcut.py", "utf8");
  ok(builder.includes("renter?v=2") && builder.includes("setclipboard") && builder.includes('"reply"'), "Shortcut copies reply");
  ok(!/vl_[A-Za-z0-9_-]{20,}/.test(builder), "no key in the shared builder");
  const pageSrc = readFileSync("app/dashboard/replies/page.tsx", "utf8");
  ok(pageSrc.includes("loadReplyKitCards("), "Quick replies and the Shortcut share one loader");
}
// S824a: the phone line says the new question was kept.
assert.equal(
  sendResultLine({ outcome: "exists", name: "Maria", rental: "833 Pillette Rd, Unit 3", questionAdded: true }),
  "Maria is already in Renters for 833 Pillette Rd, Unit 3. Their new question is on their page.",
);
console.log(`s816l send shortcut: ${n} passed, 0 failed`);
