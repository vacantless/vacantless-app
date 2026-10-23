// S734: tests for the Facebook Page post takedown helpers.
// Run: npx tsx scripts/test-facebook-page-takedown.ts
import { facebookPagePostIdFromPermalink, facebookPagePermalink } from "../lib/facebook-page-graph";
import { vacantlessTookDownNote } from "../lib/facebook-page-takedown";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => (c ? pass++ : (fail++, console.log("FAIL:", n, x ?? "")));

const link = facebookPagePermalink("1445340671985188", "122108153961508268");
ok("permalink shape", link === "https://www.facebook.com/1445340671985188_122108153961508268", link);
ok("object id from our permalink", facebookPagePostIdFromPermalink(link) === "1445340671985188_122108153961508268");
ok("object id from a pageid_postid link", facebookPagePostIdFromPermalink("https://facebook.com/12_34/") === "12_34");
ok("marketplace link is not a page post", facebookPagePostIdFromPermalink("https://www.facebook.com/marketplace/item/1000000000000001/") === null);
ok("permalink.php is not parsed", facebookPagePostIdFromPermalink("https://www.facebook.com/permalink.php?story_fbid=1&id=2") === null);
ok("other site", facebookPagePostIdFromPermalink("https://www.kijiji.ca/v-apartments/12_34") === null);
ok("empty", facebookPagePostIdFromPermalink("") === null && facebookPagePostIdFromPermalink(null) === null);
ok("garbage", facebookPagePostIdFromPermalink("not a url") === null);

const note = vacantlessTookDownNote(null, new Date("2026-10-23T12:00:00Z"));
ok("note text", note === "Taken down by Vacantless on 2026-10-23 (Facebook Page post deleted).", note);
ok("note appends", vacantlessTookDownNote("Posted by the robot.", new Date("2026-10-23T12:00:00Z")).startsWith("Posted by the robot.\nTaken down"));

console.log(`facebook-page-takedown: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
