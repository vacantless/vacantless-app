// Run with: npx tsx scripts/test-account-closure.ts
import { decideAccountClosure, ACCOUNT_CLOSURE_MESSAGES } from "../lib/account-closure";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL: ${name}`);
  }
}

const base = {
  role: "owner_admin",
  orgName: "Stranger Three Rentals",
  confirmText: "Stranger Three Rentals",
  subscriptionStatus: null,
  upcomingViewings: 0,
};
const reason = (r: ReturnType<typeof decideAccountClosure>) => (r.ok ? "ok" : r.reason);

ok("owner + exact name -> ok", reason(decideAccountClosure(base)) === "ok");
ok("case and spacing ignored", reason(decideAccountClosure({ ...base, confirmText: "  stranger  three rentals " })) === "ok");
ok("non-owner refused", reason(decideAccountClosure({ ...base, role: "operator" })) === "forbidden");
ok("no role refused", reason(decideAccountClosure({ ...base, role: null })) === "forbidden");
ok("wrong name refused", reason(decideAccountClosure({ ...base, confirmText: "Stranger Three" })) === "confirm");
ok("empty name refused", reason(decideAccountClosure({ ...base, confirmText: "" })) === "confirm");
ok("blank org name never matches", reason(decideAccountClosure({ ...base, orgName: "", confirmText: "" })) === "confirm");
ok("active plan blocks", reason(decideAccountClosure({ ...base, subscriptionStatus: "active" })) === "billing");
ok("trialing blocks", reason(decideAccountClosure({ ...base, subscriptionStatus: "trialing" })) === "billing");
ok("past_due blocks", reason(decideAccountClosure({ ...base, subscriptionStatus: "past_due" })) === "billing");
ok("canceled plan allows", reason(decideAccountClosure({ ...base, subscriptionStatus: "canceled" })) === "ok");
ok("booked viewings block", reason(decideAccountClosure({ ...base, upcomingViewings: 2 })) === "viewings");
ok("owner check runs first", reason(decideAccountClosure({ ...base, role: "operator", subscriptionStatus: "active" })) === "forbidden");
ok("every block has a message", ["forbidden", "confirm", "billing", "viewings", "error"].every((k) => k in ACCOUNT_CLOSURE_MESSAGES));
ok("messages carry no em dash", Object.values(ACCOUNT_CLOSURE_MESSAGES).every((m) => !m.includes("—")));

console.log(`\naccount-closure: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
