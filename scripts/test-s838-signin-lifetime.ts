// S838 (REVIEW-S837 1.2a): sign-in lifetimes per robot site.
// Run: npx tsx scripts/test-s838-signin-lifetime.ts
import { readFileSync } from "node:fs";
import { lifetimeLabel, signinLifetimes, type SigninEvent } from "@/lib/signin-lifetime";
import { SIGNIN_LOST_CODES } from "@/lib/signin-lost";

let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

const e = (org: string, channel: string, event: "signed_in" | "lost", at: string): SigninEvent => ({ organization_id: org, channel, event, at });
const rows = signinLifetimes([
  e("a", "rentals_ca", "signed_in", "2026-11-20T10:00:00Z"),
  e("a", "rentals_ca", "lost", "2026-11-22T22:00:00Z"), // 60 h
  e("a", "rentals_ca", "signed_in", "2026-11-23T10:00:00Z"),
  e("b", "rentals_ca", "lost", "2026-11-23T12:00:00Z"), // no start recorded
  e("b", "zumper", "signed_in", "2026-11-21T00:00:00Z"),
  e("b", "zumper", "signed_in", "2026-11-21T06:00:00Z"), // repeat keeps the first
  e("b", "zumper", "lost", "2026-11-22T00:00:00Z"), // 24 h
  e("c", "kijiji", "signed_in", "2026-11-22T00:00:00Z"),
  e("c", "kijiji", "lost", "bad date"),
]);
ok("sites in the set order", rows.map((r) => r.channel).join(",") === "kijiji,rentals_ca,zumper", rows);
const rc = rows.find((r) => r.channel === "rentals_ca")!;
ok("rentals.ca: one ended at 60 h", rc.ended === 1 && rc.medianHours === 60, rc);
ok("rentals.ca: a loss with no start is counted apart", rc.lostUnknownStart === 1, rc);
ok("rentals.ca: one signed in now", rc.signedInNow === 1, rc);
const z = rows.find((r) => r.channel === "zumper")!;
ok("zumper: repeated sign-in keeps the first, 24 h", z.ended === 1 && z.medianHours === 24 && z.signedInNow === 0, z);
const k = rows.find((r) => r.channel === "kijiji")!;
ok("kijiji: bad date ignored, still signed in", k.ended === 0 && k.medianHours === null && k.signedInNow === 1, k);
ok("median of two", signinLifetimes([e("x", "zumper", "signed_in", "2026-11-01T00:00:00Z"), e("x", "zumper", "lost", "2026-11-01T10:00:00Z"), e("x", "zumper", "signed_in", "2026-11-02T00:00:00Z"), e("x", "zumper", "lost", "2026-11-02T20:00:00Z")])[0].medianHours === 15);
ok("label hours", lifetimeLabel(30) === "30 h");
ok("label days", lifetimeLabel(60) === "2.5 days");
ok("label none", lifetimeLabel(null) === "-");

const sql = readFileSync("supabase/migrations/0331_site_signin_events.sql", "utf8");
ok("migration is additive (no drop)", !/\bdrop\b/i.test(sql));
for (const code of SIGNIN_LOST_CODES) ok(`trigger uses the same lost code ${code}`, sql.includes(`'${code}'`));
ok("trigger on alive and last_check_code", sql.includes("after insert or update of alive, last_check_code on public.distribution_channel_sessions"));
ok("grants in the same file (rule 431)", sql.includes("grant select, insert on public.site_signin_events to service_role"));
ok("not readable signed in", sql.includes("revoke all on public.site_signin_events from anon, authenticated"));
const page = readFileSync("app/dashboard/admin/page.tsx", "utf8");
ok("admin console shows it", page.includes("<SigninLifetimeSection admin={admin} />"));

console.log(`s838-signin-lifetime: ${p} passed, ${f} failed`);
if (f) process.exit(1);
