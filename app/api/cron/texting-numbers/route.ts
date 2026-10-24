import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoNumbersOn, sweepTextingNumbers } from "@/lib/texting-numbers-server";

// S736: texting numbers without staff (lib/texting-numbers). Runs in the
// 15-minute sweep: retries a number purchase that failed, and releases a
// number the app bought 7 days after its account left texting or closed.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  if (!autoNumbersOn()) return NextResponse.json({ ok: true, reason: "disabled", sent: 0 });
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return NextResponse.json({ ok: true, reason: "not_configured", sent: 0 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" }, { status: 500 });
  const out = await sweepTextingNumbers(admin);
  return NextResponse.json({ ok: true, sent: out.bought + out.released, ...out });
}
