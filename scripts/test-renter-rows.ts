// S742g: the renter list on a rental.
import { groupRenterRows } from "../lib/renter-rows";
let pass = 0, fail = 0;
function ok(n: string, c: boolean) { if (c) pass++; else { fail++; console.error("FAIL:", n); } }
const rows = [
  { id: "1", name: "Avani Panchal", email: "a@x.test", status: "new", created_at: "2026-10-30" },
  { id: "2", name: "Lauren", email: "l@x.test", status: "contacted", created_at: "2026-10-29" },
  { id: "3", name: "Rentals Alert", email: "scam@x.test", status: "lost", created_at: "2026-10-11" },
  { id: "4", name: "Bansee Patel", email: "b@x.test", status: "contacted", created_at: "2026-10-10" },
  { id: "5", name: "TEST - Noam", email: "t@x.test", status: "lost", created_at: "2026-10-08" },
  { id: "6", name: "Bansee Patel", email: "B@X.test", status: "lost", created_at: "2026-10-05" },
  { id: "7", name: "Avani Panchal", email: "a@x.test", status: "new", created_at: "2026-10-01" },
  { id: "8", name: "No Email", email: null, status: "new", created_at: "2026-10-01" },
  { id: "9", name: "no email", email: "", status: "replied", created_at: "2026-09-30" },
  { id: "10", name: "Done", email: "d@x.test", status: "leased", created_at: "2026-09-01" },
];
const g = groupRenterRows(rows);
ok("open keeps the newest per person", g.open.map((o) => o.row.id).join(",") === "1,2,4,8");
ok("a repeat request is counted, not listed twice", g.open.find((o) => o.row.id === "1")?.requests === 2);
ok("same name without email groups too", g.open.find((o) => o.row.id === "8")?.requests === 2);
ok("closed holds lost and leased, in order", g.closed.map((r) => r.id).join(",") === "3,5,6,10");
ok("a closed repeat does not merge into the open line", g.open.find((o) => o.row.id === "4")?.requests === 1);
ok("empty in, empty out", groupRenterRows([]).open.length === 0 && groupRenterRows([]).closed.length === 0);
console.log(`\nrenter-rows: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
