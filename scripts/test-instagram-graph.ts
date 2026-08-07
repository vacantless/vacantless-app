// Unit tests for Instagram Graph publishing helpers (S624).
// Run: npx tsx scripts/test-instagram-graph.ts
import {
  buildInstagramCaption,
  type InstagramFeedListing,
} from "../lib/instagram-graph";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- caption builder: full facts -------------------------------------------
{
  const caption = buildInstagramCaption({
    address: "  12 Example St, Unit 3  ",
    beds: 2,
    baths: 1.5,
    rentCents: 245000,
    publicUrl: "https://app.test/r/prop1?p=post1",
  } satisfies InstagramFeedListing);
  ok("caption includes address", caption.includes("For rent: 12 Example St, Unit 3"));
  ok("caption includes beds and baths", caption.includes("2 beds, 1.5 baths"));
  ok("caption includes rent", caption.includes("$2,450/mo"));
  ok(
    "caption includes the tracked link as plain text",
    caption.includes("https://app.test/r/prop1?p=post1"),
  );
  ok("caption has no em dash", !/[—–]/.test(caption));
}

// --- caption builder: address-missing fallback -----------------------------
{
  const caption = buildInstagramCaption({
    address: null,
    beds: null,
    baths: null,
    rentCents: 0,
    publicUrl: "https://app.test/r/prop2",
  });
  ok("caption falls back when address missing", caption.includes("Rental listing now available"));
  ok("caption omits empty facts line", !caption.includes("undefined"));
  ok("caption still includes the link", caption.includes("https://app.test/r/prop2"));
}

// --- caption builder: partial facts (beds only) ----------------------------
{
  const caption = buildInstagramCaption({
    address: "500 King St W",
    beds: 1,
    baths: null,
    rentCents: 190000,
    publicUrl: "https://app.test/r/prop3",
  });
  ok("caption singular bed label", caption.includes("1 bed"));
  ok("caption omits baths when null", !caption.includes("baths"));
  ok("caption includes rent with partial facts", caption.includes("$1,900/mo"));
}

console.log(`test-instagram-graph: ${passed}/${failed}`);
process.exit(failed > 0 ? 1 : 0);
