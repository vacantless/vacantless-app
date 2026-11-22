// Unit tests for chat renters (S767, PLAN-S766 item A).
// Run: npx tsx scripts/test-chat-leads.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  askedAgainNote,
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
import { versionAtLeast } from "../lib/marketplace-helper";

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
// S823a: one word matches a full name's last name (a chat shows one of the two)
assert.ok(sameRenterName("Chidi", "Victor chidi"));
assert.ok(sameRenterName("Victor Chidi", "chidi"));
assert.ok(!sameRenterName("Chidi", "Victor Smith"));
assert.ok(!sameRenterName("Smith", "Tess Brown"));

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
// S823a: phone share menu renters (iPhone Shortcut, Android share) are chat renters
const SHORTCUT_NOTE = "Asked: Is this 1 bed 1 bath apartment available?\nSent from the iPhone share menu (chat screenshot).";
assert.ok(isChatPlaceholder(base({ notes: SHORTCUT_NOTE })));
assert.ok(isChatPlaceholder(base({ notes: "Sent from the Android share menu (chat screenshot)." })));
assert.ok(!isChatPlaceholder(base({ notes: SHORTCUT_NOTE, email: "s@x.ca" })));
// Shnya case: Shortcut first, then the booking takes its place
assert.equal(
  findChatPlaceholderToMerge([base({ id: "sc", name: "Shnya", notes: SHORTCUT_NOTE })], {
    propertyId: P,
    name: "Shnya SarwatSleman",
    newLeadId: "new",
    now,
  })?.id,
  "sc",
);
// Chidi case: booked first, a later Shortcut save finds the booking
assert.equal(
  findExistingChatLead([base({ id: "v", name: "Victor chidi", email: "v@x.ca", notes: null, status: "new" })], {
    propertyId: P,
    name: "Chidi",
    now,
  })?.id,
  "v",
);

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
assert.equal(
  mergedChatNote(SHORTCUT_NOTE, "2026-11-19"),
  "First wrote in the chat on 2026-11-19, sent from the phone share menu. Asked: Is this 1 bed 1 bath apartment available?",
);
assert.equal(mergedChatNote("Sent from the Android share menu (chat screenshot).", "2026-11-19"), "First wrote in the chat on 2026-11-19, sent from the phone share menu.");

// The helper half (the extension sits beside the app on the Mac only; CI skips this).
if (existsSync("../vacantless-extension/app-bridge.js")) {
  const bridge = readFileSync("../vacantless-extension/app-bridge.js", "utf8");
  const watch = readFileSync("../vacantless-extension/facebook-watch.js", "utf8");
  const manifest = JSON.parse(readFileSync("../vacantless-extension/manifest.json", "utf8"));
  // S809: 1.2.6 and later still report replied chats (at least the 1.2.5 that added it).
  assert.ok(versionAtLeast(manifest.version, MARKETPLACE_HELPER_REPLIED_MIN_VERSION));
  assert.match(bridge, /data\.type === "get_replied"/);
  assert.match(bridge, /type: "replied_chats"/);
  // The page forgets by itemId|renterName, the same key the server returns.
  assert.match(bridge, /\$\{i\.itemId\}\|\$\{i\.renterName\}/);
  // Only an available rental's reply notes a renter, and the helper still makes no request.
  assert.match(watch, /if \(entry\.available\) noteReplied\(/);
  assert.ok(!/fetch\(|XMLHttpRequest/.test(watch + bridge));
}

// S767: the merge never reads rental_applications (no service-role SELECT);
// an application request always leaves an activity row, which is checked.
{
  const server = readFileSync("lib/chat-leads-server.ts", "utf8");
  assert.ok(server.includes('for (const table of ["showings", "messages"])'));
  assert.ok(!/from\("rental_applications"\)|"rental_applications"\]/.test(server));
  // S816: every send goes through the shared starter, which writes the row.
  const actions = readFileSync("app/dashboard/leads/actions.ts", "utf8");
  const req = actions.slice(actions.indexOf("export async function requestRentalApplication"));
  assert.ok(req.slice(0, 3000).includes("startRentalApplication("), "the request uses the shared starter");
  const starter = readFileSync("lib/rental-application-server.ts", "utf8");
  assert.ok(starter.includes('from("messages").insert'), "an application request writes an activity row");
}


// S824a: a renter already saved keeps their new question as a page note.
{
  assert.equal(askedAgainNote("  Is   parking included? "), "Asked again, sent from the phone share menu: Is parking included?");
  assert.equal(askedAgainNote(""), null);
  assert.equal(askedAgainNote(null), null);
  const server = readFileSync("lib/chat-leads-server.ts", "utf8");
  assert.ok(server.includes("if (input.question) await addAskedAgainNote(admin, input.orgId, existing.id, input.question);"));
  const share = readFileSync("lib/send-shortcut-server.ts", "utf8");
  assert.ok(share.includes("addAskedAgainNote(admin, orgId, hit.id, question)"), "the contact match keeps the question");
  assert.ok(share.includes("question: question || null,"), "the chat-name path passes the question");
}

console.log("PASS test-chat-leads");
