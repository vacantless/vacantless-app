// S751: public signed links use LINK_SIGNING_SECRET when set, and links signed
// with the old key (service-role key) still verify.
// Run: tsx scripts/test-s751-link-signing.ts
import fs from "node:fs";
import { linkSigningSecret, linkVerifySecrets, verifyWithAnyKey } from "../lib/link-signing";
import { signViewingCalendarToken, verifyViewingCalendarToken } from "../lib/viewing-calendar";
import { signRenterUnsubscribeToken, verifyRenterUnsubscribeToken } from "../lib/renter-unsubscribe";
import { signPhoneKitToken, verifyPhoneKitLink, phoneKitSecret } from "../lib/marketplace-phone-link";

let pass = 0;
let fail = 0;
function ok(msg: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${msg}`);
  }
}

const OLD = { SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET: "cron" };
const NEW = { ...OLD, LINK_SIGNING_SECRET: "link-key" };

ok("unset: signs with the service key (unchanged)", linkSigningSecret(OLD) === "service-key");
ok("set: signs with the link key", linkSigningSecret(NEW) === "link-key");
ok("verify keys newest first", JSON.stringify(linkVerifySecrets(NEW)) === JSON.stringify(["link-key", "service-key", "cron"]));
ok("no blanks or repeats", JSON.stringify(linkVerifySecrets({ CRON_SECRET: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })) === JSON.stringify(["x"]));

const id = "57180bcb-baca-4896-82bf-dde589d40073";
const oldCal = signViewingCalendarToken(id, "service-key");
const newCal = signViewingCalendarToken(id, "link-key");
ok("old calendar link still opens", verifyWithAnyKey((s) => verifyViewingCalendarToken(oldCal, s), NEW) === id);
ok("new calendar link opens", verifyWithAnyKey((s) => verifyViewingCalendarToken(newCal, s), NEW) === id);
ok("forged link refused", verifyWithAnyKey((s) => verifyViewingCalendarToken(signViewingCalendarToken(id, "guess"), s), NEW) === null);

const oldUnsub = signRenterUnsubscribeToken(id, "service-key");
ok("old unsubscribe link still works", !!verifyWithAnyKey((s) => verifyRenterUnsubscribeToken(oldUnsub, s), NEW));

const now = Date.UTC(2026, 10, 5);
const subj = { propertyId: id, orgId: "921f7c08-98af-428f-a238-36f4a781b0de", nowMs: now };
ok("phone kit signs with the link key", phoneKitSecret(NEW) === "link-key");
ok("old phone link still opens", verifyPhoneKitLink(signPhoneKitToken(subj, "service-key"), now, NEW).ok);
ok("new phone link opens", verifyPhoneKitLink(signPhoneKitToken(subj, "link-key"), now, NEW).ok);
ok("forged phone link refused", !verifyPhoneKitLink(signPhoneKitToken(subj, "guess"), now, NEW).ok);

for (const f of ["lib/viewing-calendar-server.ts", "lib/calendar-feed-server.ts", "lib/renter-unsubscribe-server.ts", "lib/marketplace-phone-link.ts"]) {
  ok(`${f} no longer reads the service key itself`, !fs.readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"));
}

console.log(`link-signing: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
