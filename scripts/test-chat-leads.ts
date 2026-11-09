// Unit tests for chat renters (S767, PLAN-S766 item A).
// Run: npx tsx scripts/test-chat-leads.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  CHAT_LEAD_NOTE_HELPER,
  chatLeadNoteManual,
  chatLeadSource,
  cleanRenterName,
  cleanRepliedChats,
  findChatPlaceholderToMerge,
  findExistingChatLead,
  isChatPlaceholder,
  mergedChatNote,
  normalizeRenterName,
  sameRenterName,
  type ChatLeadCandidate,
  MARKETPLACE_HELPER_REPLIED_MIN_VERSION,
} from "../lib/chat-leads";

const now = Date.parse("2026-11-09T15:00:00Z");
const day = 24 * 60 * 60_000;

// names
assert.equal(normalizeRenterName("  Zoë  O'Neil "), "zoe oneil");
assert.equal(normalizeRenterName(null), "");
assert.equal(cleanRenterName("  Tess   Smith "), "Tess Smith");
assert.equal(cleanRenterName("1234"), null);
assert.equal(cleanRenterName(""), null);
assert.equal(cleanRenterName("x".repeat(100))?.length, 80);
assert.ok(sameRenterName("Tess Smith", "tess s."));
assert.ok(sameRenterName("Tess", "Tess Smith"));
assert.ok(sameRenterName("Zoë", "Zoe Brown"));
assert.ok(!sameRenterName("Tess Smith", "Tess Brown"));
assert.ok(!sameRenterName("Tess", "Tessa"));
assert.ok(!sameRenterName("", "Tess"));

// helper payload
const cleaned = cleanRepliedChats(
  [
    { itemId: "1469392998385509", renterName: "Tess Smith", at: now - day },
    { itemId: "1469392998385509", renterName: "tess smith", at: now - day }, // same chat twice
    { itemId: "1469392998385509", renterName: "Raj", at: now - 2 * day },
    { itemId: "abc", renterName: "Bad Id", at: now },
    { itemId: "1469392998385509", renterName: "", at: now },
    { itemId: "1469392998385509", renterName: "Old", at: now - 8 * day },
    { itemId: "1469392998385509", renterName: "Future", at: now + day },
    null,
  ],
  now,
);
assert.deepEqual(
  cleaned.map((c) => c.renterName),
  ["Tess Smith", "Raj"],
);
assert.deepEqual(cleanRepliedChats("nope", now), []);

// sources and notes
assert.equal(chatLeadSource("facebook"), "Facebook Marketplace");
assert.equal(chatLeadSource("kijiji"), "Kijiji");
assert.equal(chatLeadSource("zumper"), "Zumper + PadMapper");
assert.equal(chatLeadSource("direct"), "website");
assert.equal(chatLeadSource(null), "website");
assert.equal(chatLeadNoteManual("Kijiji"), "Added from Quick replies, Kijiji chat.");
assert.ok(!/[()]/.test(CHAT_LEAD_NOTE_HELPER + chatLeadNoteManual("Kijiji")), "no parentheses in landlord copy");
assert.ok(!/—/.test(CHAT_LEAD_NOTE_HELPER + chatLeadNoteManual("Marketplace")), "no em dashes");

const P = "prop-1";
const base = (o: Partial<ChatLeadCandidate>): ChatLeadCandidate => ({
  id: "x",
  propertyId: P,
  name: "Tess",
  email: null,
  phone: null,
  status: "replied",
  notes: CHAT_LEAD_NOTE_HELPER,
  createdAt: new Date(now - day).toISOString(),
  ...o,
});

// placeholder shape
assert.ok(isChatPlaceholder(base({})));
assert.ok(isChatPlaceholder(base({ notes: chatLeadNoteManual("Marketplace") })));
assert.ok(!isChatPlaceholder(base({ email: "t@x.ca" })));
assert.ok(!isChatPlaceholder(base({ phone: "5195550100" })));
assert.ok(!isChatPlaceholder(base({ notes: "called her" })));

// existing open lead: no second save (any open lead, contact or not)
assert.equal(findExistingChatLead([base({ id: "a" })], { propertyId: P, name: "Tess Smith", now })?.id, "a");
assert.equal(findExistingChatLead([base({ id: "b", email: "t@x.ca", notes: null })], { propertyId: P, name: "Tess", now })?.id, "b");
assert.equal(findExistingChatLead([base({ status: "lost" })], { propertyId: P, name: "Tess", now }), null);
assert.equal(findExistingChatLead([base({ propertyId: "other" })], { propertyId: P, name: "Tess", now }), null);
assert.equal(findExistingChatLead([base({ createdAt: new Date(now - 15 * day).toISOString() })], { propertyId: P, name: "Tess", now }), null);
assert.equal(findExistingChatLead([base({ name: "Raj" })], { propertyId: P, name: "Tess", now }), null);

// merge on booking
assert.equal(
  findChatPlaceholderToMerge([base({ id: "ph" }), base({ id: "new", email: "t@x.ca", notes: null, status: "new" })], {
    propertyId: P,
    name: "Tess S",
    newLeadId: "new",
    now,
  })?.id,
  "ph",
);
// a real lead with contact is never merged away
assert.equal(
  findChatPlaceholderToMerge([base({ id: "real", email: "t@x.ca", notes: null })], { propertyId: P, name: "Tess", newLeadId: "new", now }),
  null,
);
// two Tess chats: never guess
assert.equal(
  findChatPlaceholderToMerge([base({ id: "a" }), base({ id: "b", name: "Tess" })], { propertyId: P, name: "Tess", newLeadId: "new", now }),
  null,
);
// another rental, closed, too old, another name: no merge
for (const o of [{ propertyId: "other" }, { status: "lost" }, { createdAt: new Date(now - 20 * day).toISOString() }, { name: "Raj" }]) {
  assert.equal(findChatPlaceholderToMerge([base(o)], { propertyId: P, name: "Tess", newLeadId: "new", now }), null);
}
assert.equal(mergedChatNote(CHAT_LEAD_NOTE_HELPER, "2026-11-08"), "First wrote in the Marketplace chat on 2026-11-08.");
assert.equal(mergedChatNote(chatLeadNoteManual("Kijiji"), "2026-11-08"), "First wrote in the chat on 2026-11-08, added from Quick replies.");

// The helper half (the extension sits beside the app on the Mac only; CI skips this).
if (existsSync("../vacantless-extension/app-bridge.js")) {
  const bridge = readFileSync("../vacantless-extension/app-bridge.js", "utf8");
  const watch = readFileSync("../vacantless-extension/facebook-watch.js", "utf8");
  const manifest = JSON.parse(readFileSync("../vacantless-extension/manifest.json", "utf8"));
  assert.equal(manifest.version, MARKETPLACE_HELPER_REPLIED_MIN_VERSION);
  assert.match(bridge, /data\.type === "get_replied"/);
  assert.match(bridge, /type: "replied_chats"/);
  // The page forgets by itemId|renterName, the same key the server returns.
  assert.match(bridge, /\$\{i\.itemId\}\|\$\{i\.renterName\}/);
  // Only an available rental's reply notes a renter, and the helper still makes no request.
  assert.match(watch, /if \(entry\.available\) noteReplied\(/);
  assert.ok(!/fetch\(|XMLHttpRequest/.test(watch + bridge));
}

console.log("PASS test-chat-leads");
