import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { getCurrentRole } from "@/lib/membership";
import { roleCan } from "@/lib/roles";
import {
  probeOauthSessions,
  requestSessionCheck,
  sessionCheckableChannels,
  sessionCheckThrottled,
  splitByConnectKind,
} from "@/lib/distribution-session-status";

// Post Everywhere Slice 1 (SPEC-S688 section 3.3). The connect tile POSTs the
// channels it found stale; account_login channels get check_requested_at set
// for the worker, oauth channels are probed inline against Graph. Behind the
// wizard flag: with it off this route does not exist, so an Agile visit to
// /dashboard/link-portals never writes a row (acceptance 3).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (process.env.DISTRIBUTION_WIZARD_ENABLED !== "1") {
    return new NextResponse("Not found", { status: 404 });
  }

  const role = await getCurrentRole();
  if (role == null || !roleCan(role, "manage_properties")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const org = await getCurrentOrg();
  if (!org) return NextResponse.json({ error: "no_org" }, { status: 401 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const rawChannels =
    body && typeof body === "object" && "channels" in body
      ? (body as { channels?: unknown }).channels
      : null;
  const { valid, rejected } = sessionCheckableChannels(rawChannels);
  if (valid.length === 0) {
    return NextResponse.json(
      { error: "no_channels", rejected },
      { status: 400 },
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const wanted = valid.filter((c) => !sessionCheckThrottled(org.id, c.key));
  const { accountLogin, oauth } = splitByConnectKind(wanted);

  let requestResult: { requested: string[]; missing: string[] };
  let probed: Awaited<ReturnType<typeof probeOauthSessions>>;
  try {
    [requestResult, probed] = await Promise.all([
      requestSessionCheck({
        orgId: org.id,
        channels: accountLogin.map((c) => c.key),
        userId: user?.id ?? null,
      }),
      probeOauthSessions({ orgId: org.id, channels: oauth.map((c) => c.key) }),
    ]);
  } catch (err) {
    // Before migration 0225 the status columns do not exist and the writes
    // fail; the tiles keep rendering from the account row. Say so, do not 500.
    console.warn(
      "[session-check] unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { error: "session_status_unavailable" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    requested: requestResult.requested,
    missing: requestResult.missing,
    probed: probed.map((p) => ({
      channel: p.channel,
      code: p.code,
      alive: p.alive,
    })),
    throttled: valid.filter((c) => !wanted.includes(c)).map((c) => c.key),
    rejected,
  });
}
