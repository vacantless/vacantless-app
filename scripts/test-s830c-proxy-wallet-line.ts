// S830c: the robot's proxy Wallet line in the daily health email (KI1756).
// Run: npx tsx scripts/test-s830c-proxy-wallet-line.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHealthDigest, decodoGb, proxyCheckedText, proxyFailed, proxyLines, type HealthInput } from "../lib/health-digest";

let n = 0;
const ok = (c: boolean, m: string) => {
  assert.ok(c, m);
  n++;
};
const base: HealthInput = {
  now: new Date("2026-11-23T13:00:00Z"),
  sweeps: [{ ran_at: "2026-11-23T12:45:00Z", ok: true, ran: [], failed: [], details: null }] as unknown as HealthInput["sweeps"],
  lastSweepAt: "2026-11-23T12:45:00Z",
  emails: { checked: true, problems: [] },
  portal: [],
  parserNotes: [],
  robot: [],
  signIns: [],
};

ok(proxyFailed("page.goto: net::ERR_TUNNEL_CONNECTION_FAILED at https://www.kijiji.ca"), "tunnel failure is the proxy");
ok(proxyFailed("net::ERR_PROXY_CONNECTION_FAILED"), "proxy connection failure");
ok(!proxyFailed("Please fix the errors") && !proxyFailed(null), "other errors are not the proxy");

const down = { ...base, robot: [{ org: "Davis", channel: "kijiji", status: "error", error: "net::ERR_TUNNEL_CONNECTION_FAILED" }] };
const l1 = proxyLines(down);
ok(l1.length === 1 && /Wallet may be short/.test(l1[0]) && /Turn ON/.test(l1[0]), "a failed post names the Wallet and Turn ON");
ok(buildHealthDigest(down).body.includes("Robot's proxy (Decodo):"), "own section in the email");

const near = { ...base, proxy: { checked: true, usedGb: 0.85, limitGb: 1 } };
ok(proxyLines(near).some((l) => l.includes("0.85 of 1.00 GB") && l.includes("$4")), "80% used warns before the next $4");
ok(proxyLines({ ...base, proxy: { checked: true, usedGb: 0.3, limitGb: 1 } }).length === 0, "30% used is quiet");
ok(buildHealthDigest({ ...base, proxy: { checked: true, usedGb: 0.3, limitGb: 1 } }).subject === "Vacantless health: all clear", "quiet day stays all clear");

const noKey = buildHealthDigest({ ...base, proxy: { checked: false, note: "no Decodo key in Vercel" } }).body;
ok(noKey.includes("Not checked:") && noKey.includes("no Decodo key in Vercel"), "says when the proxy was not checked and why");
ok(!/[—–]/.test(noKey + l1.join("") + proxyLines(near).join("")), "no dashes");

const route = readFileSync("app/api/cron/health-digest/route.ts", "utf8");
ok(route.includes("process.env.DECODO_API_KEY") && route.includes("api.decodo.com/v2/subscriptions"), "route reads Decodo with the Vercel key");
ok(!/DECODO_API_KEY\s*=\s*["']/.test(route), "no key in the code");

// S840: Pay As You Go has no GB block; the route reads 30 days of traffic instead.
ok(decodoGb(200_659_604) === 0.2, "bytes to GB, two places");
const payg = { ...base, proxy: { checked: true, usedGb: 0.42, limitGb: null, periodDays: 30 } };
ok(proxyCheckedText(payg.proxy) === ", the proxy's GB use (0.42 GB in 30 days)", "Pay As You Go shows use over 30 days");
ok(proxyLines(payg).length === 0, "no limit, no warning line");
const paygBody = buildHealthDigest(payg).body;
ok(paygBody.includes("0.42 GB in 30 days") && !paygBody.includes("Not checked: errors no page showed, the proxy"), "checked, not in Not checked");
ok(proxyCheckedText({ checked: true, usedGb: 0.3, limitGb: 1 }) === ", the proxy's GB use", "a GB block keeps the old words");
ok(route.includes("api.decodo.com/api/v2/statistics/traffic") && route.includes("total_rx_tx"), "route falls back to the traffic statistics");

console.log(`s830c proxy wallet line: ${n} passed, 0 failed`);
