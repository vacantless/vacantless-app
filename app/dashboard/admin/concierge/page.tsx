import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail } from "@/lib/provisioning";
import { adminEmails } from "@/lib/provisioning-server";
import {
  CONCIERGE_OPEN_STATUSES,
  normalizePublishChannel,
  publishChannelMeta,
  publishStatusLabel,
  normalizePublishStatus,
} from "@/lib/distribution-publish";
import {
  claimConciergeItem,
  completeConciergeItem,
  rejectConciergeItem,
} from "../concierge-actions";

export const dynamic = "force-dynamic";
// Service-role reads of cross-org run items must always see live rows.
export const fetchCache = "force-no-store";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const STALE_CONCIERGE_QUEUE_MS = 24 * 60 * 60 * 1000;

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function channelLabel(channel: string): string {
  const key = normalizePublishChannel(channel);
  return key ? publishChannelMeta(key).label : channel;
}

function conciergeQueueAge(
  requestedAt: string | null,
  nowMs: number,
): { label: string; stale: boolean } | null {
  if (!requestedAt) return null;
  const requestedMs = Date.parse(requestedAt);
  if (!Number.isFinite(requestedMs)) return null;
  const elapsedMs = Math.max(0, nowMs - requestedMs);
  const elapsedHours = Math.floor(elapsedMs / (60 * 60 * 1000));
  const elapsedDays = Math.floor(elapsedMs / (24 * 60 * 60 * 1000));
  const label =
    elapsedHours < 1
      ? "less than 1 hour ago"
      : elapsedHours < 48
        ? `${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`
        : `${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} ago`;
  return { label, stale: elapsedMs >= STALE_CONCIERGE_QUEUE_MS };
}

// The Vacantless "Publish for me" desk (S474b). Superadmin-only: it 404s for
// anyone not on the PROVISIONING_ADMIN_EMAILS allowlist. Lists every concierge
// run item across all orgs that a staff member still has to post, with the
// prepared listing and one-tap claim / mark-live / reject.
export default async function ConciergeDeskPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isAdminEmail(user?.email, adminEmails())) notFound();

  const admin = createAdminClient();
  if (!admin) {
    return (
      <div className="mx-auto max-w-5xl py-6">
        <p className="text-sm text-red-600">
          Service role is not configured, so the concierge queue can&apos;t be read.
        </p>
      </div>
    );
  }

  const { data: itemRows } = await admin
    .from("distribution_run_items")
    .select(
      "id, run_id, organization_id, channel, publish_status, mode, external_url, blockers, audit_message, error_message, concierge_requested_at, concierge_requested_by, concierge_claimed_by, concierge_claimed_at",
    )
    .eq("mode", "concierge")
    .in("publish_status", CONCIERGE_OPEN_STATUSES as unknown as string[])
    .order("concierge_requested_at", { ascending: true });

  const items = (itemRows ?? []) as Array<{
    id: string;
    run_id: string;
    organization_id: string;
    channel: string;
    publish_status: string | null;
    external_url: string | null;
    blockers: unknown;
    audit_message: string | null;
    error_message: string | null;
    concierge_requested_at: string | null;
    concierge_claimed_by: string | null;
    concierge_claimed_at: string | null;
  }>;

  // Resolve run -> property + org for the prepared-listing context.
  const runIds = Array.from(new Set(items.map((i) => i.run_id)));
  const runById = new Map<string, { property_id: string; organization_id: string }>();
  if (runIds.length > 0) {
    const { data: runs } = await admin
      .from("distribution_runs")
      .select("id, property_id, organization_id")
      .in("id", runIds);
    for (const r of (runs ?? []) as Array<{
      id: string;
      property_id: string;
      organization_id: string;
    }>) {
      runById.set(r.id, { property_id: r.property_id, organization_id: r.organization_id });
    }
  }
  const propertyIds = Array.from(
    new Set(Array.from(runById.values()).map((r) => r.property_id)),
  );
  const propById = new Map<
    string,
    { address: string | null; rent_cents: number | null; description: string | null }
  >();
  if (propertyIds.length > 0) {
    const { data: props } = await admin
      .from("properties")
      .select("id, address, rent_cents, description")
      .in("id", propertyIds);
    for (const p of (props ?? []) as Array<{
      id: string;
      address: string | null;
      rent_cents: number | null;
      description: string | null;
    }>) {
      propById.set(p.id, {
        address: p.address,
        rent_cents: p.rent_cents,
        description: p.description,
      });
    }
  }
  const orgIds = Array.from(new Set(items.map((i) => i.organization_id)));
  const orgNameById = new Map<string, string | null>();
  if (orgIds.length > 0) {
    const { data: orgs } = await admin
      .from("organizations")
      .select("id, name")
      .in("id", orgIds);
    for (const o of (orgs ?? []) as Array<{ id: string; name: string | null }>) {
      orgNameById.set(o.id, o.name);
    }
  }

  const blockersOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string")
      : [];
  const nowMs = Date.now();
  const staleUnclaimedCount = items.filter((item) => {
    if (item.concierge_claimed_by) return false;
    return conciergeQueueAge(item.concierge_requested_at, nowMs)?.stale === true;
  }).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900">
          Publish-for-me desk
        </h1>
        <p className="text-sm text-slate-500">
          Listings an operator asked Vacantless to post. Open the public page for
          the copy and photos, post to the channel, then paste the live ad URL to
          mark it live (that starts source tracking). Operator-only.
        </p>
        <p className="text-xs text-slate-400">
          {items.length} {items.length === 1 ? "item" : "items"} in the queue
        </p>
        {staleUnclaimedCount > 0 && (
          <p className="text-xs font-medium text-amber-700">
            {staleUnclaimedCount} unclaimed for more than 24 hours
          </p>
        )}
      </header>

      {items.length === 0 ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Nothing in the queue. Concierge items land here when an operator on a
          paid plan clicks &ldquo;Publish for me&rdquo; on a channel that needs a
          human to post.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => {
            const run = runById.get(item.run_id);
            const prop = run ? propById.get(run.property_id) : undefined;
            const publicUrl = run
              ? `${APP_URL}/r/${run.property_id}`
              : null;
            const status = normalizePublishStatus(item.publish_status);
            const blockers = blockersOf(item.blockers);
            const requestAge = conciergeQueueAge(
              item.concierge_requested_at,
              nowMs,
            );
            return (
              <li
                key={item.id}
                className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {channelLabel(item.channel)}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {publishStatusLabel(status)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {orgNameById.get(item.organization_id) ?? "Unknown org"} ·{" "}
                      {prop?.address ?? "(no address)"} · {money(prop?.rent_cents)}
                    </p>
                  </div>
                  {publicUrl && (
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open public page
                    </a>
                  )}
                </div>

                {/* Distribution Lane B: a realtor_ca concierge item is a
                    referral to match a LICENSED agent, not a post-it-ourselves
                    job. Flag it so the desk brokers a licensed agent instead of
                    trying to self-post to Realtor.ca. */}
                {item.channel === "realtor_ca" && (
                  <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
                    Realtor referral: match a licensed network agent. The agent
                    is the principal and lists through their own brokerage;
                    Vacantless collects no referral fee and only marks Live with
                    the real Realtor.ca link.
                  </p>
                )}

                {prop?.description && (
                  <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600 line-clamp-3">
                    {prop.description}
                  </p>
                )}
                {item.audit_message && (
                  <p className="text-xs text-slate-500">{item.audit_message}</p>
                )}
                {item.error_message && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {item.error_message}
                  </p>
                )}
                {blockers.length > 0 && (
                  <ul className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                <p
                  className={
                    requestAge?.stale && !item.concierge_claimed_by
                      ? "text-[11px] font-medium text-amber-700"
                      : "text-[11px] text-slate-400"
                  }
                >
                  {item.concierge_claimed_by
                    ? `Claimed${item.concierge_claimed_at ? " " + new Date(item.concierge_claimed_at).toLocaleString() : ""}`
                    : requestAge
                      ? `Unclaimed, requested ${requestAge.label}`
                      : "Unclaimed, requested time missing"}
                </p>
                {requestAge?.stale && !item.concierge_claimed_by && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Unclaimed for more than 24 hours. Claim, post, or reject it
                    so the operator is not left waiting.
                  </p>
                )}

                <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                  {!item.concierge_claimed_by && (
                    <form action={claimConciergeItem}>
                      <input type="hidden" name="item_id" value={item.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Claim
                      </button>
                    </form>
                  )}

                  <form
                    action={completeConciergeItem}
                    className="flex items-end gap-2"
                  >
                    <input type="hidden" name="item_id" value={item.id} />
                    <div className="w-64">
                      <label
                        htmlFor={`c-${item.id}-url`}
                        className="mb-1 block text-[11px] font-medium text-slate-500"
                      >
                        Live ad URL
                      </label>
                      <input
                        id={`c-${item.id}-url`}
                        name="external_url"
                        defaultValue={item.external_url ?? ""}
                        placeholder="https://..."
                        className={FIELD}
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Mark live
                    </button>
                  </form>

                  <form
                    action={rejectConciergeItem}
                    className="flex items-end gap-2"
                  >
                    <input type="hidden" name="item_id" value={item.id} />
                    <div className="w-56">
                      <label
                        htmlFor={`c-${item.id}-reason`}
                        className="mb-1 block text-[11px] font-medium text-slate-500"
                      >
                        Reject reason
                      </label>
                      <input
                        id={`c-${item.id}-reason`}
                        name="reason"
                        placeholder="Why it couldn't be posted"
                        className={FIELD}
                      />
                    </div>
                    <button
                      type="submit"
                      className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
