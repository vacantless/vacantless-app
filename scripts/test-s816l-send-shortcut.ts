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
import { SEND_SHORTCUT_STEPS } from "../lib/send-shortcut-copy";

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

console.log(`s816l send shortcut: ${n} passed, 0 failed`);
