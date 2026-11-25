import { getUserByIdCached } from "@/lib/auth-email-cache";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import {
  getNotificationEvent,
  isDripEnqueueEnabled,
  isEventEnabled,
  renderNotification,
  resolveNotificationRecipients,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";
import {
  confirmationCountLabel,
  confirmationListBatches,
  confirmationListLine,
  CONFIRMATION_NUDGE_SENT_COLUMN,
  HOUR_MS,
  pendingRescheduleShowingIds,
  shortViewingAddress,
  type ConfirmationListRow,
  type PendingRescheduleProposalRow,
} from "@/lib/reminders";
import { claimNull, releaseClaim } from "@/lib/claim-stamp";

// S843a: this sweep now sends ONE LIST per agent per day, about 3 hours before
// their first viewing of the day the renter has not confirmed: every viewing of
// theirs that local day, unconfirmed ones first with a phone number, so they can
// text or call before a no-show. It used to send one email per viewing at 24h,
// in the same minute as the renter's own reminder, so it fired on nearly every
// viewing. The notes below describe the original shape where they still hold.
//
// Pre-showing UNCONFIRMED-nudge sweep (S440, showing routing Slice 3) — the
// mirror of the post-showing outcome nudge. When an assigned viewing is coming up
// (within 24h) and still hasn't been confirmed with the renter, the ASSIGNED
// AGENT gets ONE reminder with a one-tap {{agent_url}} link to their shared
// calendar, so an unconfirmed viewing doesn't silently slip and the lead agent
// doesn't have to chase. Closes the "did anyone confirm this?" gap the "Howard"
// episode exposed.
//
// EMAIL only, via the notification substrate. The assigned agent is the natural
// party and is ALWAYS included (audienceEmail); an org can add CC recipients
// (e.g. the lead agent) in Settings. When the agent has no email on file, the
// nudge falls back to the operator members so someone still sees it. ONE nudge
// per showing: confirmationNudgeDue gates on assigned + unconfirmed + open + a
// future start within 24h, and confirmation_nudge_sent_at is stamped after send.
//
// SHIP DARK: opt-in per org (isDripEnqueueEnabled) — nothing fires until the org
// turns "Unconfirmed viewing reminder" on in Automations & Templates.
//
// Auth: CRON_SECRET (Bearer or ?secret=). Test affordances (CRON_SECRET-gated):
//   ?org=<id>   limit the sweep to one org
//   ?force=1    bypass the already-sent stamp (still sends + re-stamps)
//   ?dry=1      build + return what WOULD send, without sending or stamping
//
// Reads showings across all orgs via the service-role client (RLS hides them from
// anon/user sessions); see lib/supabase/admin.ts.

// S748: every sweep gets the full 60 s; sweep-all waits up to 50 s for each.
export const maxDuration = 60;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_RECIPIENTS = 10;
const EVENT_KEY = "leasing.showing_unconfirmed_nudge";

type Summary = {
  ok: boolean;
  reason?: string;
  scanned: number; // orgs scanned
  sent: number; // emails sent (or "would send" in dry mode)
  skipped: number; // orgs/showings not actionable / opt-out
  errors: number;
  details: Array<Record<string, unknown>>;
};

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // not configured → refuse
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return false; // S751: header only (a secret in the URL lands in request logs)
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return (rel as T) ?? null;
}

// Read far enough ahead to hold the whole local day of a viewing that is due.
const LIST_HORIZON_MS = 30 * HOUR_MS;

function fmtTimeOnly(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function fmtDayLabel(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function fmtShowingTime(iso: string | null, tz: string): string {
  if (!iso) return "the scheduled time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
  confirmed_at: string | null;
  assigned_agent_id: string | null;
  confirmation_nudge_sent_at: string | null;
  lead: { name: string | null; phone: string | null; email: string | null } | null;
  property: { address: string | null } | null;
  assigned_agent: {
    name: string | null;
    email: string | null;
    agent_token: string | null;
    archived: boolean | null;
  } | null;
};

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, reason: "service_role_not_configured", scanned: 0, sent: 0, skipped: 0, errors: 0, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const params = req.nextUrl.searchParams;
  const force = params.get("force") === "1";
  const dry = params.get("dry") === "1";
  const onlyOrg = params.get("org");

  const event = getNotificationEvent(EVENT_KEY);
  if (!event) {
    return NextResponse.json(
      { ok: false, reason: "event_not_registered", scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  let orgQuery = admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, mail_alias, reply_to_email, public_contact_email, booking_timezone");
  if (onlyOrg) orgQuery = orgQuery.eq("id", onlyOrg);
  const { data: orgs, error: orgErr } = await orgQuery;

  if (orgErr) {
    return NextResponse.json(
      { ok: false, reason: `org_query_error:${orgErr.message}`, scanned: 0, sent: 0, skipped: 0, errors: 1, details: [] } satisfies Summary,
      { status: 200 },
    );
  }

  const nowMs = Date.now();
  // S843a: every open assigned viewing from now to 30h out, so one sweep holds
  // the whole local day of whichever viewing has come due.
  const soonestIso = new Date(nowMs).toISOString();
  const latestIso = new Date(nowMs + LIST_HORIZON_MS).toISOString();

  const summary: Summary = { ok: true, scanned: (orgs ?? []).length, sent: 0, skipped: 0, errors: 0, details: [] };

  for (const org of (orgs ?? []) as any[]) {
    // Per-org isolation: one org's thrown error must not abort the sweep.
    try {
      const tz: string = org.booking_timezone || "America/Toronto";

      // Opt-in gate (ship dark): only sweep orgs that have turned the event on.
      const { data: settingRow } = await admin
        .from("notification_settings")
        .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
        .eq("organization_id", org.id)
        .eq("event_key", EVENT_KEY)
        .maybeSingle();
      const setting = (settingRow as NotificationSettingRow | null) ?? null;
      if (!isDripEnqueueEnabled(setting)) {
        summary.skipped++;
        continue;
      }

      // Confirmed and already-listed viewings are read too: confirmed ones ride
      // along in the list, and the stamp decides what still needs a list.
      const { data: showRows } = await admin
        .from("showings")
        .select(
          "id, scheduled_at, outcome, confirmed_at, assigned_agent_id, confirmation_nudge_sent_at, " +
            "lead:leads(name, phone, email), property:properties(address), " +
            "assigned_agent:showing_agents(name, email, agent_token, archived)",
        )
        .eq("organization_id", org.id)
        .not("assigned_agent_id", "is", null)
        .gte("scheduled_at", soonestIso)
        .lte("scheduled_at", latestIso)
        .or("outcome.is.null,outcome.eq.scheduled");
      const candidateRows = showRows ?? [];
      const candidateIds = (candidateRows as any[])
        .map((row) => row.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      let eligibleRows = candidateRows;
      if (candidateIds.length > 0) {
        const { data: proposalRows, error: proposalErr } = await admin
          .from("showing_reschedule_proposals")
          .select("showing_id, status, responded_at")
          .in("showing_id", candidateIds)
          .eq("status", "pending")
          .is("responded_at", null);
        if (proposalErr) {
          summary.errors++;
          summary.details.push({ org: org.id, error: `reschedule_query_error:${proposalErr.message}` });
          continue;
        }
        const pendingRescheduleIds = pendingRescheduleShowingIds(
          (proposalRows ?? []) as PendingRescheduleProposalRow[],
        );
        eligibleRows = (candidateRows as any[]).filter(
          (row) => !pendingRescheduleIds.has(row.id),
        );
      }

      const byId = new Map<string, ShowingRow>();
      const listRows: ConfirmationListRow[] = [];
      for (const row of eligibleRows as unknown as ShowingRow[]) {
        if (!row.scheduled_at) continue;
        byId.set(row.id, row);
        listRows.push({
          id: row.id,
          agentId: row.assigned_agent_id,
          scheduledAtMs: new Date(row.scheduled_at).getTime(),
          confirmed: row.confirmed_at != null,
          outcome: row.outcome,
          alreadySent: force ? false : row.confirmation_nudge_sent_at != null,
        });
      }
      const batches = confirmationListBatches(listRows, nowMs, tz);
      if (batches.length === 0) {
        summary.skipped++;
        continue;
      }

      // Operator members, resolved once per org and only if needed (the fallback
      // for an assigned agent with no email on file).
      let operatorMembers: string[] | null = null;
      const ensureMembers = async (): Promise<string[]> => {
        if (operatorMembers) return operatorMembers;
        const { data: memberRows } = await admin
          .from("memberships")
          .select("user_id, role")
          .eq("organization_id", org.id);
        const members: NotifyMember[] = [];
        for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
          const { data: u } = await getUserByIdCached(admin, m.user_id);
          members.push({ role: m.role, email: u?.user?.email ?? null });
        }
        operatorMembers = resolveLeadNotifyEmails(members, [
          org.reply_to_email,
          org.public_contact_email,
        ]).slice(0, MAX_RECIPIENTS);
        return operatorMembers;
      };

      for (const batch of batches) {
        const claimed: string[] = [];
        try {
          const first = byId.get(batch.unconfirmed[0] ?? "");
          if (!first || !first.scheduled_at) {
            summary.skipped++;
            continue;
          }
          const agent = one<{
            name: string | null;
            email: string | null;
            agent_token: string | null;
            archived: boolean | null;
          }>(first.assigned_agent);
          // An ARCHIVED agent's link is revoked (the /agent/[token] page 404s for
          // it), so never send them the list or consume the stamps: skip WITHOUT
          // stamping, so if the agent is un-archived (or the viewings reassigned)
          // a later sweep still sends. (Codex S440 P2.)
          if (agent?.archived) {
            summary.skipped++;
            continue;
          }
          // Without a token there is no /agent link to send; skip (defensive; the
          // 0117 backfill gives every agent a token).
          if (!agent?.agent_token) {
            summary.skipped++;
            continue;
          }

          // S742c: claim before sending, one stamp per listed viewing; released
          // below when nothing was delivered. ?force=1 and ?dry=1 list without
          // claiming (a forced row is already stamped; a dry run changes nothing).
          let listIds: string[] = batch.unconfirmed;
          if (!dry && !force) {
            for (const id of batch.unconfirmed) {
              const claim = await claimNull(admin, "showings", { id }, CONFIRMATION_NUDGE_SENT_COLUMN);
              if (claim.outcome === "claimed") claimed.push(id);
            }
            listIds = claimed;
          }
          if (listIds.length === 0) {
            summary.skipped++;
            summary.details.push({ org: org.id, agent: batch.agentId, skipped: "already_claimed" });
            continue;
          }

          const line = (id: string, withContact: boolean): string | null => {
            const r = byId.get(id);
            if (!r?.scheduled_at) return null;
            const lead = one<{ name: string | null; phone: string | null; email: string | null }>(r.lead);
            const prop = one<{ address: string | null }>(r.property);
            return confirmationListLine({
              time: fmtTimeOnly(r.scheduled_at, tz),
              name: lead?.name,
              address: prop?.address,
              contact: withContact ? lead?.phone?.trim() || lead?.email?.trim() || "no phone on file" : null,
            });
          };
          const unconfirmedLines = listIds.map((id) => line(id, true)).filter((x): x is string => !!x);
          const confirmedLines = batch.confirmed.map((id) => line(id, false)).filter((x): x is string => !!x);
          const firstListed = byId.get(listIds[0]) ?? first;
          const firstLead = one<{ name: string | null }>(firstListed.lead);
          const firstProp = one<{ address: string | null }>(firstListed.property);
          const firstName = firstLead?.name?.trim() || "a renter";
          const agentEmail = agent.email?.trim() || null;
          const vars: Record<string, string> = {
            org_name: org.name ?? "",
            agent_name: agent.name?.trim() || "there",
            day_label: fmtDayLabel(first.scheduled_at, tz),
            count_label: confirmationCountLabel(listIds.length, listIds.length + confirmedLines.length),
            unconfirmed_list: unconfirmedLines.join("\n"),
            confirmed_list: confirmedLines.length > 0 ? confirmedLines.join("\n") : "None yet.",
            agent_url: `${APP_URL}/agent/${agent.agent_token}`,
            // Kept for an account that customized the old one-viewing wording.
            property_address: shortViewingAddress(firstProp?.address),
            lead_name: listIds.length > 1 ? `${firstName} and ${listIds.length - 1} more` : firstName,
            showing_time: fmtShowingTime(firstListed.scheduled_at, tz),
          };

          // The assigned agent is the natural recipient (audienceEmail = always
          // included). Only fall back to operator members when the agent has no
          // email, so a routine reminder doesn't spam the whole team.
          const fallback = agentEmail ? [] : await ensureMembers();

          if (dry) {
            const rendered = renderNotification(event, setting, vars);
            const recipients = resolveNotificationRecipients({
              audience: event.audience,
              configured: setting?.recipients ?? [],
              audienceEmail: agentEmail,
              operatorFallback: fallback,
            });
            summary.sent++; // "would send"
            summary.details.push({
              org: org.id,
              agent: batch.agentId,
              showings: listIds,
              dry: true,
              enabled: isEventEnabled(setting),
              recipients,
              subject: rendered.subject,
              body: rendered.body,
              agent_url: vars.agent_url,
            });
            continue;
          }

          const result = await sendOrgNotification({
            client: admin,
            org: {
              id: org.id,
              name: org.name,
              brand_color: org.brand_color,
              logo_url: org.logo_url,
              reply_to_email: org.reply_to_email,
            },
            eventKey: EVENT_KEY,
            audienceEmail: agentEmail,
            operatorFallback: fallback,
            vars,
            action: { label: "Open my viewings", url: vars.agent_url },
          });

          // The email IS the product action, so the stamps stand only when at
          // least one email actually sent. A provider failure / empty recipient
          // resolution must NOT consume them: release so the next sweep retries.
          if (!result.delivered) {
            for (const id of claimed) {
              await releaseClaim(admin, "showings", { id }, { [CONFIRMATION_NUDGE_SENT_COLUMN]: null });
            }
            summary.skipped++;
            summary.details.push({
              org: org.id,
              agent: batch.agentId,
              showings: listIds,
              sent: false,
              not_stamped: true,
              reason: result.skipped ?? "send_failed",
              attempted: result.attempted,
            });
            continue;
          }

          summary.sent++;
          summary.details.push({ org: org.id, agent: batch.agentId, showings: listIds, sent: true });
        } catch (e: any) {
          // A throw after claiming must not eat the day's list: hand the stamps back.
          for (const id of claimed) {
            try {
              await releaseClaim(admin, "showings", { id }, { [CONFIRMATION_NUDGE_SENT_COLUMN]: null });
            } catch {}
          }
          summary.errors++;
          summary.details.push({ org: org.id, agent: batch.agentId, error: `batch_threw:${String(e?.message ?? e)}` });
        }
      }
    } catch (e: any) {
      summary.errors++;
      summary.details.push({ org: org?.id, error: String(e?.message ?? e) });
    }
  }

  return NextResponse.json(summary, { status: 200 });
}
