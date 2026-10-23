// S734: tests for lib/renter-sources.ts. Run: npx tsx scripts/test-renter-sources.ts
import { renterSourcesForRental, renterSourcesSummary } from "../lib/renter-sources";
import type { LeadLite } from "../lib/reports";

let pass = 0;
let fail = 0;
const ok = (n: string, c: boolean, x?: unknown) => (c ? pass++ : (fail++, console.log("FAIL:", n, x ?? "")));

const lead = (source: string | null, status: LeadLite["status"] = "new"): LeadLite => ({
  id: Math.random().toString(36).slice(2),
  source,
  status,
  created_at: "2026-10-01T00:00:00Z",
  leased_date: null,
  property_id: "p1",
});

const leads = [
  ...Array.from({ length: 6 }, () => lead("Facebook Marketplace")),
  lead("Facebook Marketplace", "booked"),
  lead("Facebook Marketplace", "booked"),
  lead("Rentals.ca"),
  lead("Rentals.ca"),
  lead("Kijiji (email)"),
  lead("website"),
  lead("website", "booked"),
  lead(null),
];
const s = renterSourcesForRental(leads);
ok("total", s.total === 14);
ok("sites by count, marketplace first", s.rows[0].site === "Facebook Marketplace" && s.rows[0].enquiries === 8 && s.rows[0].booked === 2, s.rows);
ok("kijiji (email) folds into Kijiji", s.rows.some((r) => r.site === "Kijiji" && r.enquiries === 1));
ok("unnamed folded into one last row", s.rows[s.rows.length - 1].site === "Your Vacantless page link" && s.unnamed === 3, s.rows);
ok("unnamed row carries its booked count", s.rows[s.rows.length - 1].booked === 1);
ok("share is a percent", s.rows[0].share === 57);
ok("advice names the best site", s.advice?.text.startsWith("Facebook Marketplace brings you the most booked viewings") === true, s.advice);
ok("summary line", renterSourcesSummary(s, 2) === "Facebook Marketplace 8 · Rentals.ca 2", renterSourcesSummary(s, 2));

const empty = renterSourcesForRental([]);
ok("empty", empty.total === 0 && empty.rows.length === 0 && empty.advice === null);
const few = renterSourcesForRental([lead("Kijiji"), lead("Kijiji")]);
ok("no advice under five inquiries", few.advice === null && few.rows[0].site === "Kijiji");

console.log(`renter-sources: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
