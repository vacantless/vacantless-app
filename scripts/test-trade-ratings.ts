// S776e shared, rated local trades (migration 0284). Run: npx tsx scripts/test-trade-ratings.ts
import { readFileSync } from "node:fs";
import { canRateWorkOrder, parseHireAgain, parseStars, ratingLine, yourRatingLine } from "@/lib/trade-ratings";
let p = 0, f = 0;
function ok(n: string, c: boolean, g?: unknown) { if (c) p++; else { f++; console.log("FAIL", n, JSON.stringify(g ?? "")); } }

ok("stars 1..5 kept", parseStars("1") === 1 && parseStars("5") === 5 && parseStars(" 3 ") === 3);
ok("stars out of range refused", parseStars("0") === null && parseStars("6") === null && parseStars("") === null && parseStars("x") === null);
ok("hire again", parseHireAgain("yes") === true && parseHireAgain("no") === false && parseHireAgain("") === null);
ok("only finished jobs with a trade", canRateWorkOrder({ status: "completed", trade_contact_id: "t" }) && !canRateWorkOrder({ status: "open", trade_contact_id: "t" }) && !canRateWorkOrder({ status: "completed", trade_contact_id: null }));
ok("no score, no line", ratingLine(null) === null && ratingLine({ rating_avg: null, rating_count: 0, landlord_count: 0 }) === null);
ok("score line", ratingLine({ rating_avg: "4.6", rating_count: 7, landlord_count: 3 }) === "4.6 out of 5 from 7 jobs, 3 landlords");
ok("score line singular", ratingLine({ rating_avg: 5, rating_count: 1, landlord_count: 1 }) === "5.0 out of 5 from 1 job, 1 landlord");
ok("your rating", yourRatingLine(4, true) === "You rated this job 4 out of 5, would hire again." && yourRatingLine(2, null) === "You rated this job 2 out of 5.");

const m = readFileSync("supabase/migrations/0284_trade_ratings.sql", "utf8");
ok("one rating per job", m.includes("unique (work_order_id)"));
ok("insert needs a finished job by that trade", m.includes("w.trade_contact_id = trade_ratings.trade_contact_id") && m.includes("w.status = 'completed'"));
ok("ratings private by RLS", m.includes("enable row level security") && m.includes("using (organization_id in (select public.user_org_ids()))"));
ok("scores share only aggregates of live listings", m.includes("round(avg(x.stars)::numeric, 1)") && m.includes("d.listed = true and d.archived = false") && !/reporter|tenant|cost_cents|quote/.test(m.split("create or replace function public.directory_trade_scores")[1] ?? ""));
ok("scores not for anon", m.includes("revoke all on function public.directory_trade_scores() from public, anon;"));
const actions = readFileSync("app/dashboard/maintenance/actions.ts", "utf8");
ok("added trade links its listing", actions.includes("directory_trade_id: id,"));
ok("rate action upserts one per job", actions.includes('onConflict: "work_order_id"') && actions.includes("canRateWorkOrder(w)"));
const page = readFileSync("app/dashboard/maintenance/page.tsx", "utf8");
ok("page shows score and rating form", page.includes("★ {l.score}") && page.includes("action={rateTradeOnJob}") && page.includes('supabase.rpc("directory_trade_scores")'));
console.log(`trade-ratings: ${p} passed, ${f} failed`);
if (f) process.exit(1);
