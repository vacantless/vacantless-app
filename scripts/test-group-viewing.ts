// S775 group viewings per rental (migration 0280). Run: npx tsx scripts/test-group-viewing.ts
import { readFileSync } from "node:fs";
import { accountGroupRule, groupViewingLine, parseGroupSize } from "@/lib/group-viewing";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

ok("blank keeps the account rule", parseGroupSize("") === null && parseGroupSize(null) === null);
ok("4 kept", parseGroupSize("4") === 4);
ok("1 kept", parseGroupSize("1") === 1);
ok("0, 21 and text refused", parseGroupSize("0") === null && parseGroupSize("21") === null && parseGroupSize("abc") === null);
ok("rounds", parseGroupSize("3.6") === 4);

ok("one renter: no line", groupViewingLine(1) === null && groupViewingLine(undefined) === null && groupViewingLine(null) === null);
ok("open house line", groupViewingLine(0) === "These are group viewings. Other renters may join the same time.");
ok("group of 4 line", groupViewingLine(4) === "These are group viewings, up to 4 renters at each time.");
ok("account hint", accountGroupRule(true).includes("no limit") && accountGroupRule(false).includes("one renter"));

const mig = readFileSync("supabase/migrations/0280_group_viewings.sql", "utf8");
ok("0280 adds the column with 1..20", mig.includes("viewing_group_size integer") && mig.includes("between 1 and 20"));
ok("0280 full time raises unique_violation (read as taken by every booking path)", mig.includes("errcode = 'unique_violation', message = 'Viewing time is full'"));
ok("0280 serializes per account and time", (mig.match(/pg_advisory_xact_lock/g) || []).length >= 2);
ok("0280 availability says the size", mig.includes("''group_size''"));
ok("0280 is idempotent and refuses a missing anchor", mig.includes("already applied") && mig.includes("booked block not found"));

const form = readFileSync("app/r/[propertyId]/inquiry-form.tsx", "utf8");
const page = readFileSync("app/r/[propertyId]/page.tsx", "utf8");
ok("renter page passes the line", page.includes("groupLine={groupViewingLine(av?.group_size)}") && form.includes("{groupLine && ("));
const rental = readFileSync("app/dashboard/properties/[id]/page.tsx", "utf8");
const actions = readFileSync("app/dashboard/properties/actions.ts", "utf8");
ok("rental form has the field", rental.includes('name="viewing_group_size"') && rental.includes("viewing_group_size, status"));
ok("save reads it inside the viewing rules block", actions.includes('viewing_group_size: parseGroupSize(formData.get("viewing_group_size"))'));
const book = readFileSync("app/dashboard/leads/[id]/book-actions.ts", "utf8");
ok("staff booking reads 23505 as taken", book.includes('"23505" ? "taken"'));

console.log(`group-viewing: ${p} passed, ${f} failed`);
if (f) process.exit(1);
