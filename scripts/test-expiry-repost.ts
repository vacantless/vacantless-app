// S756: expiry re-post decision (lib/expiry-repost).
import assert from "node:assert/strict";
import {
  expiryRepostDecision,
  expiryRepostAudit,
  expiryRepostNoteLine,
  removalDateFromNotes,
  EXPIRY_REPOST_MARK,
} from "../lib/expiry-repost";

let n = 0;
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); n++; };

const KIJ = "S708: Kijiji ad 1744721877\nlive-check 2026-11-13 14:31Z: REMOVED (kijiji_expired). Row flipped live -> removed by the listing-post live check; nothing was re-posted.";
const HOME = "rentals_ca listing 1576011\n2026-11-14 home live check: Rentals.ca no longer shows this ad (redirects to https://rentals.ca/windsor).";
eq(removalDateFromNotes(KIJ), "2026-11-13", "app live-check line");
eq(removalDateFromNotes(HOME), "2026-11-14", "home check line");
eq(removalDateFromNotes(`${KIJ}\nNoam: leave it down`), null, "a person wrote after the check");
eq(removalDateFromNotes(null), null, "no notes");
eq(removalDateFromNotes("Unpublished on Zumper 2026-10-31 (S741)"), null, "hand removal");

const base: Parameters<typeof expiryRepostDecision>[0] = {
  portal: "kijiji",
  postStatus: "removed",
  notes: KIJ,
  postedOn: "2026-10-12" as string | null,
  propertyStatus: "available",
  propertyArchived: false,
  addonAllowed: true,
  autopilot: true,
  sessionAlive: true,
  channelShown: true,
  nowISO: "2026-11-13T14:35:00Z",
};
const r = (o: Partial<Parameters<typeof expiryRepostDecision>[0]>) => expiryRepostDecision({ ...base, ...o }).reason;
eq(expiryRepostDecision(base), { repost: true, reason: "repost" }, "Kijiji 60-day expiry on an available rental");
eq(r({ portal: "rentals_ca", notes: HOME, nowISO: "2026-11-15T14:30:00Z" }), "repost", "Rentals.ca via the home check");
eq(r({ portal: "zumper" }), "repost", "Zumper");
eq(r({ portal: "facebook_feed" }), "not_robot_site", "Page posts are not robot sites");
eq(r({ portal: "facebook" }), "not_robot_site", "Marketplace stays the landlord's");
eq(r({ postStatus: "live" }), "not_removed", "still live");
eq(r({ notes: `${KIJ}\n2026-11-13 ${EXPIRY_REPOST_MARK}: queued run item x to post it again.` }), "already_handled", "once per row");
eq(r({ notes: "Unpublished on Zumper 2026-10-31 by Noam" }), "not_a_live_check_removal", "hand takedown never re-posts");
eq(r({ nowISO: "2026-11-17T14:35:00Z" }), "removal_too_old", "old gap is the landlord's call");
eq(r({ nowISO: "2026-11-16T00:00:00Z" }), "repost", "3 days is still inside the window");
eq(r({ postedOn: "2026-11-09" }), "pulled_too_soon", "up 4 days: moderation, not expiry");
eq(r({ postedOn: null }), "pulled_too_soon", "unknown age never re-posts");
eq(r({ propertyStatus: "leased" }), "rental_not_available", "leased");
eq(r({ propertyStatus: "off_market" }), "rental_not_available", "off market");
eq(r({ propertyArchived: true }), "rental_not_available", "archived");
eq(r({ channelShown: false }), "site_hidden", "site hidden for the org");
eq(r({ addonAllowed: false }), "no_posting_addon", "no Posting add-on");
eq(r({ autopilot: false }), "setting_off", "standing setting off");
eq(r({ sessionAlive: false }), "signed_out", "signed out of the site");

const audit = expiryRepostAudit("kijiji");
assert.match(audit, /Kijiji ad ended/); n++;
assert.doesNotMatch(audit, /—/, "no em dash"); n++;
assert.match(expiryRepostNoteLine("2026-11-13T14:35:00Z", "abc"), /^2026-11-13 expiry re-post: queued run item abc/); n++;
assert.ok(expiryRepostNoteLine("2026-11-13T14:35:00Z", null).includes(EXPIRY_REPOST_MARK), "the skip line also marks the row"); n++;
// The note line itself must read as handled on the next run.
eq(r({ notes: `${KIJ}\n${expiryRepostNoteLine("2026-11-13T14:35:00Z", "abc")}` }), "already_handled", "the line we write blocks a second run");
// Real prod line (Pillette 3 on Zumper, S756 read): Zumper dropped it about 45 days in.
const ZUMPER_REAL = 'live-check 2026-10-22 18:40Z: REMOVED (zumper_notify_me_page). Zumper listing 65274297 renders "Alert me when this rental is available" (no price, no inquiry CTA). Row flipped live -> removed by the listing-post live check; nothing was re-posted.';
eq(r({ portal: "zumper", notes: ZUMPER_REAL, postedOn: "2026-09-06", nowISO: "2026-10-22T18:45:00Z" }), "repost", "real Zumper removal, same day");
eq(r({ portal: "zumper", notes: ZUMPER_REAL, postedOn: "2026-09-06", nowISO: "2026-11-06T14:30:00Z" }), "removal_too_old", "the October gaps stay the landlord's call");
console.log(`PASS test-expiry-repost (${n} checks)`);
