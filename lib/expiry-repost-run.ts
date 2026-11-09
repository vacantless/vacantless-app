// S756: the server half of lib/expiry-repost. Called once at the end of the
// daily listing-post live check (app/api/cron/listing-post-live-check), with
// the service-role client. It scans robot-site ads a live check removed in the
// last few days (the app check for Kijiji and Zumper, the home check for
// Rentals.ca, which ran earlier the same day or the day before) and re-queues
// the run item that made each one, the same fields "Post it for me" writes.
// The posting worker then prepares it and the standing setting approves a
// free ad; a paid Kijiji ad stops at checkout for the landlord.
//
// Write is the live check's own gate (LISTING_POST_LIVE_CHECK_ENABLED and not
// ?dry=1). Best-effort: never throws; every row gets a reason in the summary.
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROBOT_POSTED_CHANNELS, isHiddenForOrg } from "./posting-lanes";
import { readRobotPostingAccess, type RobotPostingAccess } from "./robot-posting-access";
import {
  EXPIRY_REPOST_MARK,
  expiryRepostAudit,
  expiryRepostDecision,
  expiryRepostNoteLine,
  type ExpiryRepostReason,
} from "./expiry-repost";

const SCAN_LIMIT = 100;
/** Publish states that mean a post for this site is already on its way. */
const IN_FLIGHT = ["queued", "submitting", "submitted", "needs_operator", "needs_login", "needs_payment"];
/** States a finished posting item can be re-queued from. */
const REUSABLE = ["live", "skipped", "rejected"];

export type ExpiryRepostDetail = {
  post: string;
  portal: string;
  property: string;
  reason: ExpiryRepostReason | "already_live" | "already_in_flight" | "no_item" | "write_failed";
  item: string | null;
  wrote: boolean;
};

export type ExpiryRepostSummary = { scanned: number; queued: number; details: ExpiryRepostDetail[]; error?: string };

type PostRow = {
  id: string;
  organization_id: string;
  property_id: string;
  portal: string;
  status: string | null;
  notes: string | null;
  posted_on: string | null;
  created_at: string | null;
};

export async function queueExpiryReposts(
  admin: SupabaseClient,
  opts: { write: boolean; nowISO?: string },
): Promise<ExpiryRepostSummary> {
  const nowISO = opts.nowISO ?? new Date().toISOString();
  const out: ExpiryRepostSummary = { scanned: 0, queued: 0, details: [] };
  try {
    const { data: rows, error } = await admin
      .from("listing_posts")
      .select("id, organization_id, property_id, portal, status, notes, posted_on, created_at")
      .eq("status", "removed")
      .in("portal", [...ROBOT_POSTED_CHANNELS])
      .or("notes.ilike.%live-check%,notes.ilike.%home live check%")
      .not("notes", "ilike", `%${EXPIRY_REPOST_MARK}%`)
      .order("created_at", { ascending: false })
      .limit(SCAN_LIMIT);
    if (error) return { ...out, error: error.message };

    const accessByOrg = new Map<string, RobotPostingAccess>();
    const aliveByOrg = new Map<string, Set<string>>();

    for (const row of (rows ?? []) as PostRow[]) {
      out.scanned++;
      const detail: ExpiryRepostDetail = {
        post: row.id,
        portal: row.portal,
        property: row.property_id,
        reason: "not_removed",
        item: null,
        wrote: false,
      };
      out.details.push(detail);

      const { data: prop } = await admin
        .from("properties")
        .select("status, archived_at")
        .eq("id", row.property_id)
        .maybeSingle();
      // S767: per rental (a Free account's one live rental may be re-posted).
      const accessKey = `${row.organization_id}|${row.property_id}`;
      let access = accessByOrg.get(accessKey);
      if (!access) {
        access = await readRobotPostingAccess(admin, row.organization_id, { rental: row.property_id });
        accessByOrg.set(accessKey, access);
      }
      let alive = aliveByOrg.get(row.organization_id);
      if (!alive) {
        const { data: sessions } = await admin
          .from("distribution_channel_session_status")
          .select("channel, alive")
          .eq("organization_id", row.organization_id)
          .eq("alive", true);
        alive = new Set(((sessions ?? []) as { channel: string }[]).map((s) => s.channel));
        aliveByOrg.set(row.organization_id, alive);
      }
      const p = prop as { status: string | null; archived_at: string | null } | null;
      const decision = expiryRepostDecision({
        portal: row.portal,
        postStatus: row.status,
        notes: row.notes,
        postedOn: row.posted_on ?? row.created_at,
        propertyStatus: p?.status ?? null,
        propertyArchived: !!p?.archived_at,
        addonAllowed: access.allowed,
        autopilot: access.autopilot,
        sessionAlive: alive.has(row.portal),
        channelShown: !isHiddenForOrg(row.portal, row.organization_id),
        nowISO,
      });
      detail.reason = decision.reason;
      if (!decision.repost) continue;

      // Never a second ad: one already live, or a post already on its way.
      const { count: liveCount } = await admin
        .from("listing_posts")
        .select("id", { count: "exact", head: true })
        .eq("property_id", row.property_id)
        .eq("portal", row.portal)
        .eq("status", "live");
      if ((liveCount ?? 0) > 0) {
        detail.reason = "already_live";
        continue;
      }
      const { data: runs } = await admin
        .from("distribution_runs")
        .select("id")
        .eq("property_id", row.property_id);
      const runIds = ((runs ?? []) as { id: string }[]).map((r) => r.id);
      if (runIds.length > 0) {
        const { data: flying } = await admin
          .from("distribution_run_items")
          .select("id, transport")
          .in("run_id", runIds)
          .eq("channel", row.portal)
          .in("publish_status", IN_FLIGHT);
        if (((flying ?? []) as { transport: string | null }[]).some((f) => f.transport !== "takedown")) {
          detail.reason = "already_in_flight";
          continue;
        }
      }

      const { data: items } = await admin
        .from("distribution_run_items")
        .select("id, run_id, transport, publish_status, updated_at")
        .eq("organization_id", row.organization_id)
        .eq("listing_post_id", row.id)
        .eq("channel", row.portal)
        .in("publish_status", REUSABLE)
        .order("updated_at", { ascending: false });
      const item = ((items ?? []) as { id: string; run_id: string; transport: string | null }[]).find(
        (i) => i.transport !== "takedown",
      );
      if (!item) {
        detail.reason = "no_item";
        if (opts.write) {
          // Mark the row so the gap is left to "Post to the missing sites" and
          // this run never looks at it again.
          await admin
            .from("listing_posts")
            .update({ notes: appendLine(row.notes, expiryRepostNoteLine(nowISO, null)) })
            .eq("id", row.id)
            .eq("status", "removed");
        }
        continue;
      }
      detail.item = item.id;
      if (!opts.write) continue;

      const { error: updErr } = await admin
        .from("distribution_run_items")
        .update({
          mode: "concierge",
          transport: null,
          publish_status: "queued",
          status: "in_progress",
          listing_post_id: null,
          external_url: null,
          operator_action_url: null,
          operator_submit_approved_at: null,
          operator_submit_approved_by: null,
          external_posted_at: null,
          external_expires_at: null,
          blockers: [],
          concierge_requested_at: nowISO,
          concierge_requested_by: null,
          concierge_claimed_by: null,
          concierge_claimed_at: null,
          audit_message: expiryRepostAudit(row.portal),
          error_code: null,
          error_message: null,
          updated_at: nowISO,
        })
        .eq("id", item.id)
        .in("publish_status", REUSABLE);
      if (updErr) {
        detail.reason = "write_failed";
        console.error("[expiry-repost] item update failed", { item: item.id, error: updErr.message });
        continue;
      }
      await admin
        .from("distribution_runs")
        .update({ status: "active", completed_at: null })
        .eq("id", item.run_id)
        .eq("status", "completed");
      await admin
        .from("listing_posts")
        .update({ notes: appendLine(row.notes, expiryRepostNoteLine(nowISO, item.id)) })
        .eq("id", row.id)
        .eq("status", "removed");
      detail.wrote = true;
      out.queued++;
      console.log(`[expiry-repost] post=${row.id} portal=${row.portal} item=${item.id} queued`);
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err);
  }
  return out;
}

function appendLine(notes: string | null, line: string): string {
  const prior = (notes ?? "").replace(/\s+$/, "");
  return prior ? `${prior}\n${line}` : line;
}
