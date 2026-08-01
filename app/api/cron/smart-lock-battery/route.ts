import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSmartLockBatterySweep } from "@/lib/smart-lock-battery-sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        reason: "service_role_not_configured",
        scanned: 0,
        sent: 0,
        skipped: 0,
        errors: 0,
        details: [],
      },
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const summary = await runSmartLockBatterySweep({
    client: admin,
    appUrl: APP_URL,
    onlyOrg: params.get("org"),
    force: params.get("force") === "1",
    dry: params.get("dry") === "1",
  });

  return NextResponse.json(summary, { status: 200 });
}
