// ---------------------------------------------------------------------------
// S697g - the database half of self-closing publish requests.
//
// Reads the org's open concierge post items for one property, decides with the
// pure layer, and settles the ones that are no longer work. Best effort by
// design: a lease-up, an archive or a recorded live ad must never fail because
// the desk could not be tidied afterwards.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import { channelByKey } from "@/lib/distribution-channels";
import { CONCIERGE_OPEN_STATUSES } from "@/lib/distribution-publish";
import {
  STALE_CLOSE_PUBLISH_STATUS,
  STALE_CLOSE_ROW_STATUS,
  shouldStaleCloseItem,
  staleCloseAudit,
  type StaleCloseTrigger,
} from "@/lib/concierge-stale-close";

type ItemRow = {
  id: string;
  channel: string | null;
  mode: string | null;
  transport: string | null;
  publish_status: string | null;
};

function labelFor(channel: string | null): string {
  if (!channel) return "this site";
  return channelByKey(channel)?.label ?? channel.replace(/_/g, " ");
}

/**
 * Close every open concierge post request for one property that the given
 * trigger has made pointless.
 *
 * `channel` narrows it to a single site, which is what "already_live" wants:
 * recording a live Kijiji ad should close the Kijiji request and leave the
 * Facebook one alone.
 *
 * Returns how many items were closed. Never throws.
 */
export async function closeStaleConciergeItems(
  supabase: SupabaseClient,
  args: {
    organizationId: string;
    propertyId: string;
    trigger: StaleCloseTrigger;
    channel?: string | null;
  },
): Promise<number> {
  const { organizationId, propertyId, trigger } = args;
  if (!organizationId || !propertyId) return 0;

  try {
    // Runs are the only link from a property to its items, so resolve them
    // first and keep the org filter on both reads.
    const { data: runData } = await supabase
      .from("distribution_runs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("property_id", propertyId);
    const runIds = ((runData ?? []) as { id: string }[]).map((r) => r.id);
    if (runIds.length === 0) return 0;

    let query = supabase
      .from("distribution_run_items")
      .select("id, channel, mode, transport, publish_status")
      .eq("organization_id", organizationId)
      .in("run_id", runIds)
      .eq("mode", "concierge")
      .in("publish_status", CONCIERGE_OPEN_STATUSES as unknown as string[]);
    if (args.channel) query = query.eq("channel", args.channel);

    const { data: itemData } = await query;
    const items = (itemData ?? []) as ItemRow[];

    const closeable = items.filter((item) =>
      shouldStaleCloseItem({
        publishStatus: item.publish_status as never,
        transport: item.transport,
        mode: item.mode,
      }),
    );
    if (closeable.length === 0) return 0;

    const now = new Date().toISOString();
    let closed = 0;
    for (const item of closeable) {
      const { error } = await supabase
        .from("distribution_run_items")
        .update({
          publish_status: STALE_CLOSE_PUBLISH_STATUS,
          status: STALE_CLOSE_ROW_STATUS,
          blockers: [],
          audit_message: staleCloseAudit(trigger, labelFor(item.channel)),
          updated_at: now,
        })
        .eq("id", item.id)
        // Re-assert the open state so a desk member working the item at the
        // same moment wins and their outcome is not overwritten.
        .in("publish_status", CONCIERGE_OPEN_STATUSES as unknown as string[]);
      if (!error) closed += 1;
    }
    return closed;
  } catch {
    return 0;
  }
}
