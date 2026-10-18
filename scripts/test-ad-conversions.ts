// S723: tests for lib/ad-conversions.ts. Run: npx tsx scripts/test-ad-conversions.ts
import { adTagConfig, adTagsOn, conversionsToFire, isMarketingPath, markSent, sentMap } from "../lib/ad-conversions";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => (c ? pass++ : (fail++, console.log("FAIL:", n, x ?? "")));
const now = new Date("2026-10-25T12:00:00Z");

// Config: off with nothing, bad values ignored.
ok("empty env off", !adTagsOn(adTagConfig({})));
ok("bad google id off", !adTagsOn(adTagConfig({ GOOGLE_ADS_ID: "UA-123" })));
ok("script in pixel off", !adTagsOn(adTagConfig({ META_PIXEL_ID: "123'><script>" })));
const cfg = adTagConfig({ GOOGLE_ADS_ID: " AW-1234567890 ", GOOGLE_ADS_SIGNUP_LABEL: "abcDEF_12", META_PIXEL_ID: "123456789012345" });
ok("google parsed", cfg.googleId === "AW-1234567890");
ok("label parsed", cfg.signupLabel === "abcDEF_12" && cfg.liveLabel === null);
ok("pixel parsed", cfg.metaPixelId === "123456789012345" && adTagsOn(cfg));

// Pages.
for (const p of ["/", "/about", "/realtors", "/signup", "/compare/showinghero", "/privacy", "/about/"]) ok(`marketing ${p}`, isMarketingPath(p));
for (const p of ["/r/abc", "/showing/x", "/f/y", "/dashboard", "/login", "/onboarding", "/apply/z", "/comparex"]) ok(`not marketing ${p}`, !isMarketingPath(p));

// Conversions.
const base = { createdAt: "2026-10-20T10:00:00Z", sent: {}, hasLiveRental: false, isOwnTest: false, now };
ok("new account -> signup", JSON.stringify(conversionsToFire(base)) === '["signup"]');
ok("live -> both", JSON.stringify(conversionsToFire({ ...base, hasLiveRental: true })) === '["signup","first_live"]');
ok("already sent -> none", conversionsToFire({ ...base, hasLiveRental: true, sent: { signup: "x", first_live: "y" } }).length === 0);
ok("old account never", conversionsToFire({ ...base, createdAt: "2026-10-01T00:00:00Z", hasLiveRental: true }).length === 0);
ok("our test never", conversionsToFire({ ...base, isOwnTest: true }).length === 0);
ok("no created never", conversionsToFire({ ...base, createdAt: null }).length === 0);
ok("signup window", conversionsToFire({ ...base, now: new Date("2026-12-30T00:00:00Z") }).length === 0);
ok("live window 90d", JSON.stringify(conversionsToFire({ ...base, hasLiveRental: true, sent: { signup: "x" }, now: new Date("2026-12-30T00:00:00Z") })) === '["first_live"]');

// Marking.
const m = markSent({ signup: "2026-10-20T00:00:00.000Z" }, ["signup", "first_live", "evil"], now);
ok("keeps first time", m.signup === "2026-10-20T00:00:00.000Z");
ok("adds live", m.first_live === now.toISOString());
ok("drops unknown", !("evil" in m));
ok("sentMap junk", Object.keys(sentMap("x")).length === 0 && Object.keys(sentMap([1])).length === 0);

console.log(`ad-conversions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
