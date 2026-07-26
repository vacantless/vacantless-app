// Unit tests for the pure S575 lease-up ad lifecycle decision ladder.
// Run: npx tsx scripts/test-leaseup-decision.ts
import {
  decideLeaseupAdLifecycle,
  type LeaseupDecisionInput,
} from "../lib/leaseup-decision";

let pass = 0;
let fail = 0;

function ok(name: string, condition: boolean) {
  if (condition) pass++;
  else {
    fail++;
    console.error(`  x ${name}`);
  }
}

const base: LeaseupDecisionInput = {
  propertyStatus: "leased",
  channel: "facebook_feed",
  isPaid: false,
  siblingAvailableCount: 0,
  waitlistEnabled: true,
};

{
  const d = decideLeaseupAdLifecycle({ ...base, isPaid: true });
  ok("paid ad skips automatic removal", d.action === "skip_paid");
  ok("paid reason names paid placement", /paid placement/.test(d.reason));
}

{
  const d = decideLeaseupAdLifecycle({
    ...base,
    siblingAvailableCount: 2,
  });
  ok("compatible open sibling steers to pool", d.action === "steer_to_pool");
  ok("pool reason includes sibling count", /2 compatible/.test(d.reason));
}

{
  const d = decideLeaseupAdLifecycle({
    ...base,
    waitlistEnabled: true,
  });
  ok("waitlist on repoints demand capture", d.action === "repoint_to_waitlist");
  ok("waitlist reason mentions capture", /waiting-list capture/.test(d.reason));
}

{
  const d = decideLeaseupAdLifecycle({
    ...base,
    waitlistEnabled: false,
  });
  ok("no pool and waitlist off takes down", d.action === "takedown");
  ok("takedown reason mentions waitlist off", /waitlist is off/.test(d.reason));
}

{
  const d = decideLeaseupAdLifecycle({
    ...base,
    isPaid: true,
    siblingAvailableCount: 4,
    waitlistEnabled: false,
  });
  ok("paid wins before pool and takedown", d.action === "skip_paid");
}

{
  const d = decideLeaseupAdLifecycle({
    ...base,
    siblingAvailableCount: 1,
    waitlistEnabled: false,
  });
  ok("pool wins before hard takedown", d.action === "steer_to_pool");
}

if (fail > 0) {
  console.error(`leaseup-decision: ${pass}/${pass + fail} passed`);
  process.exit(1);
}

console.log(`leaseup-decision: ${pass}/${pass + fail} passed`);
