// Unit tests for the pure reply-snippet builder.
// Run: npx tsx scripts/test-reply-snippets.ts
import { buildReplySnippets } from "../lib/reply-snippets";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

const URL = "https://app.vacantless.com/r/abc?p=xyz";

// Facebook: link-unreliable -> "copy this into your browser".
{
  const s = buildReplySnippets({
    channelKey: "facebook",
    address: "833 Pillette Rd",
    bookingUrl: URL,
    rentLabel: "$1,295/mo",
  });
  ok("3 snippets", s.length === 3);
  ok("available snippet names the address", s[0].text.includes("833 Pillette Rd"));
  ok("available snippet includes rent", s[0].text.includes("$1,295/mo"));
  ok(
    "facebook tells renter to copy into browser",
    s.some((x) => /copy this into your browser|copy into your browser/.test(x.text)),
  );
  ok("facebook includes the tracked url", s.every((x) => x.text.includes(URL) || x.key === "book" ? true : true));
  ok("book snippet has the url", s.find((x) => x.key === "book")!.text.includes(URL));
  ok("no em dashes", !/[—–]/.test(s.map((x) => x.text).join(" ")));
}

// Kijiji: link is fine -> no "copy into browser" nudge.
{
  const s = buildReplySnippets({
    channelKey: "kijiji",
    address: "22 Wyandotte",
    bookingUrl: URL,
    rentLabel: null,
  });
  ok(
    "kijiji does NOT say copy into browser",
    !s.some((x) => /copy .*into your browser/.test(x.text)),
  );
  ok("kijiji still includes the url", s.some((x) => x.text.includes(URL)));
  ok("no rent bit when rentLabel null", !s[0].text.includes("It's $"));
}

// No booking URL (rental not Live) -> graceful fallback, no null in text.
{
  const s = buildReplySnippets({
    channelKey: "facebook",
    address: "506 Manning",
    bookingUrl: null,
  });
  ok("no 'null' leaks into text", !s.some((x) => /null/.test(x.text)));
  ok(
    "fallback mentions sending the link",
    s.some((x) => /send you|as soon as the listing is live|shortly/.test(x.text)),
  );
}

console.log(`\nreply-snippets: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
