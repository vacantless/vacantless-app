// S734: tests for lib/facebook-page-photos.ts. Run: npx tsx scripts/test-facebook-page-photos.ts
import { albumDescriptionExcerpt, buildPageAlbumMessage, FB_ALBUM_DESCRIPTION_MAX } from "../lib/facebook-page-photos";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => (c ? pass++ : (fail++, console.log("FAIL:", n, x ?? "")));

const msg = buildPageAlbumMessage({
  address: " 12 Example St, Unit 3 ",
  beds: 2,
  baths: 1,
  rentCents: 165000,
  description: "Bright corner unit with a big window.\n\nSecond paragraph that should not appear.",
  publicUrl: "https://app.test/r/p1?p=x",
});
ok("headline", msg.startsWith("For rent: 12 Example St, Unit 3\n\n2 beds, 1 bath | $1,650/mo"), msg);
ok("first paragraph only", msg.includes("Bright corner unit with a big window.") && !msg.includes("Second paragraph"));
ok("booking line then link on its own line", msg.endsWith("Pick a time that suits you.\n\nhttps://app.test/r/p1?p=x"));
ok("no em dash", !/[—–]/.test(msg));

const noDesc = buildPageAlbumMessage({ address: null, beds: null, baths: null, rentCents: 0, description: "   ", publicUrl: "https://app.test/r/p2" });
ok("fallback headline and no blank blocks", noDesc === "Rental listing now available\n\nBook a viewing online at the link below. Pick a time that suits you.\n\nhttps://app.test/r/p2", noDesc);

const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} is here.`).join(" ");
const ex = albumDescriptionExcerpt(long) ?? "";
ok("long description cut on a sentence", ex.length <= FB_ALBUM_DESCRIPTION_MAX && ex.endsWith("."), ex.length);
ok("empty description is null", albumDescriptionExcerpt("") === null && albumDescriptionExcerpt(null) === null);

console.log(`facebook-page-photos: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
