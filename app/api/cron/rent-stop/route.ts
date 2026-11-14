import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runScheduledRentStops } from "@/lib/stripe-rent-stop";

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
  return NextResponse.json(summary, { status: 200 });
}
