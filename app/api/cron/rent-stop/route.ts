import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runScheduledRentStops } from "@/lib/stripe-rent-stop";
import { runRotessaNsfSweep } from "@/lib/rotessa-nsf-server";
import { rotessaNsfDue } from "@/lib/rotessa-nsf";
import { torontoDateHour } from "@/lib/health-digest";

// S796b: carries out "stop rent after the last payment". A tenancy with
// rent_stop_after set keeps collecting until the payment on that date clears,
// then this sweep cancels the debit (lib/stripe-rent-stop). Safe to run twice.

export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, reason: "service_role_not_configured" }, { status: 200 });
  }
  const summary = await runScheduledRentStops({ admin });
  console.log("[rent-stop]", JSON.stringify(summary));
  // S835d: Rotessa sends nothing when a debit fails, so read its report three
  // times a day (?nsf=1 reads now). One charge per failed transaction.
  const { date: today, hour } = torontoDateHour(new Date());
  const forceNsf = req.nextUrl.searchParams.get("nsf") === "1";
  if (!forceNsf && !rotessaNsfDue(hour)) return NextResponse.json(summary, { status: 200 });
  const nsf = await runRotessaNsfSweep({ admin, todayIso: today });
  console.log("[rotessa-nsf]", JSON.stringify(nsf));
  return NextResponse.json({ ...summary, ok: summary.ok && nsf.ok, nsf }, { status: 200 });
}
