// S739 Instagram carousel, against a fake Graph API. Run: npx tsx scripts/test-instagram-carousel.ts
import { readFileSync } from "node:fs";
import { postToInstagram, instagramPhotoUrls, IG_CAROUSEL_MAX_PHOTOS } from "@/lib/instagram-graph";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

type Call = { method: string; path: string; body: Record<string, string> };
function fakeGraph(opts: { failImage?: string; authFailImage?: string; permFailImage?: string } = {}) {
  const calls: Call[] = [];
  let n = 0;
  (globalThis as { fetch: unknown }).fetch = async (input: string | URL, init?: { method?: string; body?: URLSearchParams }) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? Object.fromEntries(init.body.entries()) : {};
    calls.push({ method, path: url.pathname, body });
    const json = (status: number, obj: unknown) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
    if (method === "POST" && url.pathname.endsWith("/media")) {
      if (opts.authFailImage && body.image_url === opts.authFailImage) return json(400, { error: { message: "Session expired", code: 190, type: "OAuthException" } });
      if (opts.permFailImage && body.image_url === opts.permFailImage) return json(403, { error: { message: "Permissions error", code: 200, type: "OAuthException" } });
      if (opts.failImage && body.image_url === opts.failImage) return json(400, { error: { message: "Bad image", code: 9004, type: "OAuthException" } });
      return json(200, { id: `c${++n}` });
    }
    if (method === "POST" && url.pathname.endsWith("/media_publish")) return json(200, { id: "m1" });
    if (url.searchParams.get("fields") === "status_code") return json(200, { status_code: "FINISHED" });
    if (url.searchParams.get("fields") === "permalink") return json(200, { permalink: "https://www.instagram.com/p/abc/" });
    return json(404, {});
  };
  return calls;
}
const creates = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path.endsWith("/media"));
const base = { igUserId: "17841", pageAccessToken: "tok", caption: "2 bed, $1,450" };
const A = "https://x.supabase.co/a.jpg", B = "https://x.supabase.co/b.jpg", C = "https://x.supabase.co/c.jpg";

// Photo list.
ok("cover first, no repeats, https only", JSON.stringify(instagramPhotoUrls([A, A, "http://x/y.jpg", "", B, 3])) === JSON.stringify([A, B]));
ok("at most five", instagramPhotoUrls(Array.from({ length: 9 }, (_, i) => `https://x/${i}.jpg`)).length === IG_CAROUSEL_MAX_PHOTOS);
ok("not a list", instagramPhotoUrls(null).length === 0);

async function main() {
// Three photos: a carousel.
{
  const calls = fakeGraph();
  const r = await postToInstagram({ ...base, imageUrl: A, imageUrls: [A, B, C] });
  const cr = creates(calls);
  ok("carousel posts", r.ok && r.photoCount === 3, r);
  ok("three items then one carousel", cr.length === 4 && cr.slice(0, 3).every((c) => c.body.is_carousel_item === "true" && !c.body.caption), cr.map((c) => c.body));
  ok("carousel holds the three in order", cr[3].body.media_type === "CAROUSEL" && cr[3].body.children === "c1,c2,c3" && cr[3].body.caption === base.caption, cr[3]?.body);
  ok("publishes the carousel", calls.some((c) => c.path.endsWith("/media_publish") && c.body.creation_id === "c4"));
}
// One photo: as before.
{
  const calls = fakeGraph();
  const r = await postToInstagram({ ...base, imageUrl: A, imageUrls: [A] });
  const cr = creates(calls);
  ok("single photo posts", r.ok && r.photoCount === 1, r);
  ok("single photo: one container with caption, no carousel", cr.length === 1 && cr[0].body.image_url === A && cr[0].body.caption === base.caption && !cr[0].body.media_type);
}
// Old callers (no imageUrls): unchanged.
{
  const calls = fakeGraph();
  const r = await postToInstagram({ ...base, imageUrl: A });
  ok("old call shape still works", r.ok && creates(calls).length === 1);
}
// A refused photo: falls back to the cover alone.
{
  const calls = fakeGraph({ failImage: B });
  const r = await postToInstagram({ ...base, imageUrl: A, imageUrls: [A, B, C] });
  const cr = creates(calls);
  ok("bad photo falls back to the cover", r.ok && r.photoCount === 1, r);
  ok("fallback is a captioned cover post", cr[cr.length - 1].body.image_url === A && cr[cr.length - 1].body.caption === base.caption && !cr.some((c) => c.body.media_type === "CAROUSEL"));
}
// A permission error on a photo also stops.
{
  const calls = fakeGraph({ permFailImage: B });
  const r = await postToInstagram({ ...base, imageUrl: A, imageUrls: [A, B] });
  ok("permission error stops", !r.ok && r.isAuthError, r);
  ok("permission error publishes nothing", !calls.some((c) => c.path.endsWith("/media_publish")));
}
// A sign-in error: stop, publish nothing.
{
  const calls = fakeGraph({ authFailImage: A });
  const r = await postToInstagram({ ...base, imageUrl: A, imageUrls: [A, B] });
  ok("sign-in error stops", !r.ok && r.isAuthError, r);
  ok("nothing published after a sign-in error", !calls.some((c) => c.path.endsWith("/media_publish")));
}

const action = readFileSync("app/dashboard/properties/distribution-actions.ts", "utf8");
ok("Set Live passes the photos", action.includes("const imageUrls = instagramPhotoUrls(pubPhotos);") && /postToInstagram\(\{[\s\S]{0,80}imageUrls,/.test(action));

console.log(`instagram-carousel: ${p} passed, ${f} failed`);
if (f) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
