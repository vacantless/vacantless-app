import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BREVO_BLOCKED_ENDPOINT,
  buildTeamAddressSet,
  teamAddressesToUnblock,
  type BrevoBlockedContact,
} from "@/lib/team-unsubscribe-guard";

// S717: takes team addresses back off Brevo's blocklist after a stray
// one-click unsubscribe (lib/team-unsubscribe-guard.ts, KI1289). Runs in the
// 15-minute sweep. ?dry=1 reports what it would unblock without changing it.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function readBlocked(apiKey: string): Promise<BrevoBlockedContact[]> {
  const all: BrevoBlockedContact[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const res = await fetch(`${BREVO_BLOCKED_ENDPOINT}?limit=100&offset=${offset}`, {
      headers: { "api-key": apiKey, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`brevo_${res.status}`);
    const json = (await res.json()) as { contacts?: BrevoBlockedContact[]; count?: number };
    const page = json.contacts ?? [];
    all.push(...page);
    if (page.length < 100) break;
  }
  return all;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return NextResponse.json({ ok: false, reason: "no_api_key" }, { status: 500 });
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: false, reason: "service_role_not_configured" });
  const dry = req.nextUrl.searchParams.get("dry") === "1";

  let blocked: BrevoBlockedContact[];
  try {
    blocked = await readBlocked(apiKey);
  } catch (e) {
    console.error("[team-unsubscribe-guard] blocked list read failed", (e as Error).message);
    return NextResponse.json(
      { ok: false, reason: `blocked_read:${(e as Error).message}` },
      { status: 500 },
    );
  }
  if (blocked.length === 0) {
    console.log("[team-unsubscribe-guard] blocked=0");
    return NextResponse.json({ ok: true, blocked: 0, unblocked: [] });
  }

  const [orgs, settings, lanes, agents, members] = await Promise.all([
    admin.from("organizations").select("reply_to_email, public_contact_email"),
    admin.from("notification_settings").select("recipients"),
    admin.from("org_notification_lanes").select("recipients"),
    admin.from("showing_agents").select("email"),
    admin.from("memberships").select("user_id"),
  ]);

  // One page of up to 1000 users per call instead of one call per member.
  const memberEmails: string[] = [];
  const userIds = new Set(((members.data ?? []) as { user_id: string }[]).map((m) => m.user_id));
  for (let page = 1; page <= 50; page++) {
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (listErr) break;
    const users = list?.users ?? [];
    for (const u of users) if (userIds.has(u.id) && u.email) memberEmails.push(u.email);
    if (users.length < 1000) break;
  }

  const team = buildTeamAddressSet([
    memberEmails,
    ((orgs.data ?? []) as { reply_to_email: string | null; public_contact_email: string | null }[])
      .flatMap((o) => [o.reply_to_email, o.public_contact_email]),
    ((settings.data ?? []) as { recipients: string[] | null }[]).flatMap((r) => r.recipients ?? []),
    ((lanes.data ?? []) as { recipients: string[] | null }[]).flatMap((r) => r.recipients ?? []),
    ((agents.data ?? []) as { email: string | null }[]).map((a) => a.email),
  ]);

  const toUnblock = teamAddressesToUnblock(blocked, team);
  const unblocked: string[] = [];
  const failed: string[] = [];
  if (!dry) {
    for (const email of toUnblock) {
      const res = await fetch(`${BREVO_BLOCKED_ENDPOINT}/${encodeURIComponent(email)}`, {
        method: "DELETE",
        headers: { "api-key": apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null);
      if (res && (res.ok || res.status === 404)) unblocked.push(email);
      else failed.push(`${email}:${res?.status ?? "error"}`);
    }
    if (unblocked.length > 0) console.warn("[team-unsubscribe-guard] unblocked", unblocked);
  }

  console.log(
    `[team-unsubscribe-guard] blocked=${blocked.length} team=${team.size} toUnblock=${toUnblock.length} unblocked=${unblocked.length} failed=${failed.length} dry=${dry}`,
  );
  return NextResponse.json({
    ok: failed.length === 0,
    dry,
    blocked: blocked.length,
    team: team.size,
    wouldUnblock: dry ? toUnblock : undefined,
    unblocked,
    failed,
  }, { status: failed.length === 0 ? 200 : 500 });
}
