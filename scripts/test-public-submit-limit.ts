// S742b: the public form limits. Pure parts plus the fail-open contract.
import {
  LIMITS,
  allowHit,
  allowPublicSubmit,
  clientIpFrom,
  ipKey,
} from "../lib/public-submit-limit";
import { HONEYPOT_FIELD, honeypotTripped } from "../lib/public-submit-fields";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    console.error("FAIL:", name);
  }
}

// honeypot
ok("empty field is a person", !honeypotTripped(() => ""));
ok("missing field is a person", !honeypotTripped(() => null));
ok("filled field is a script", honeypotTripped((k) => (k === HONEYPOT_FIELD ? "http://x" : "")));
ok("spaces only is a person", !honeypotTripped(() => "   "));

// ip
ok("first forwarded address wins", clientIpFrom((n) => (n === "x-forwarded-for" ? "1.2.3.4, 5.6.7.8" : null)) === "1.2.3.4");
ok("real-ip fallback", clientIpFrom((n) => (n === "x-real-ip" ? "9.9.9.9" : null)) === "9.9.9.9");
ok("no header is null", clientIpFrom(() => null) === null);
ok("key is short and not the address", (ipKey("1.2.3.4") ?? "").length === 24 && !(ipKey("1.2.3.4") ?? "").includes("1.2.3.4"));
ok("same address, same key", ipKey("1.2.3.4") === ipKey("1.2.3.4"));
ok("null address, null key", ipKey(null) === null);

// limits are generous
ok("ip limit is above a busy family", LIMITS.perIp.limit >= 10);
ok("property limit is above a hot listing", LIMITS.perProperty.limit >= 30);

async function main() {
  // fails open
  ok("no client allows", await allowHit(null, "k", LIMITS.perIp));
  ok("rpc error allows", await allowHit({ rpc: async () => ({ data: null, error: { message: "x" } }) }, "k", LIMITS.perIp));
  ok("rpc throw allows", await allowHit({ rpc: async () => { throw new Error("down"); } }, "k", LIMITS.perIp));
  // honours the answer
  ok("rpc false blocks", !(await allowHit({ rpc: async () => ({ data: false, error: null }) }, "k", LIMITS.perIp)));
  ok("rpc true allows", await allowHit({ rpc: async () => ({ data: true, error: null }) }, "k", LIMITS.perIp));

  // both buckets, in order, with the right windows
  const calls: Record<string, unknown>[] = [];
  const admin = { rpc: async (_fn: string, args: Record<string, unknown>) => { calls.push(args); return { data: true, error: null }; } };
  const r = await allowPublicSubmit(admin, { ip: "1.2.3.4", propertyId: "p1" });
  ok("allowed when both under", r.allowed && r.reason === null);
  ok("two buckets counted", calls.length === 2);
  ok("ip bucket first", String(calls[0]?.p_key).startsWith("ip:") && calls[0]?.p_window_seconds === LIMITS.perIp.window);
  ok("property bucket second", calls[1]?.p_key === "prop:p1" && calls[1]?.p_limit === LIMITS.perProperty.limit);

  const blockIp = { rpc: async (_fn: string, args: Record<string, unknown>) => ({ data: !String(args.p_key).startsWith("ip:"), error: null }) };
  const b = await allowPublicSubmit(blockIp, { ip: "1.2.3.4", propertyId: "p1" });
  ok("ip over limit blocks with reason", !b.allowed && b.reason === "ip");

  const noIp = await allowPublicSubmit(admin, { ip: null, propertyId: "p2" });
  ok("no address still counts the rental", noIp.allowed && calls.length === 3 && calls[2]?.p_key === "prop:p2");

  console.log(`\npublic-submit-limit: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main();
