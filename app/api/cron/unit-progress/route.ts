import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runUnitProgressSweep } from "@/lib/unit-progress-notify";

// S788d: unit progress reminders to the crew and the landlord's copy when a
// reminder sat 3 days (lib/unit-progress-reminders). Every account with a
// crew. Safe to run twice: a reminder is recorded when sent and the cadence
// reads those records.

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
  const summary = await runUnitProgressSweep({ admin });
  console.log("[unit-progress]", JSON.stringify(summary));
  return NextResponse.json(summary, { status: 200 });
}
