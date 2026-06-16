import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { statusLabel, type LeadStatus } from "@/lib/pipeline";
import {
  resolveLeadSource,
  followUpStatus,
  followUpLabel,
  suggestedNextStageOptions,
  type FollowUpStatus,
} from "@/lib/lead-detail";
import { StatusSelect } from "../status-select";
import { addNote, setNextAction, clearNextAction, updateLeadStatus } from "../actions";
import { OutcomeSelect } from "../../showings/outcome-select";

export const dynamic = "force-dynamic";

type ListingPost = {
  portal: string | null;
  label: string | null;
  url: string | null;
} | null;

type Lead = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  source_detail: string | null;
  status: LeadStatus;
  notes: string | null;
  move_in: string | null;
  next_action_at: string | null;
  next_action_note: string | null;
  created_at: string;
  property: { id: string; address: string } | null;
  listing_post: ListingPost;
};

type Message = {
  id: string;
  channel: string | null;
  direction: string | null;
  body: string | null;
  created_at: string;
};

type Showing = {
  id: string;
  scheduled_at: string | null;
  outcome: string;
};

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: lead } = await supabase
    .from("leads")
    .select(
      "id, name, email, phone, source, source_detail, status, notes, move_in, next_action_at, next_action_note, created_at, property:properties(id, address), listing_post:listing_posts(portal, label, url)",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!lead) notFound();
  const l = lead as unknown as Lead;

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, channel, direction, body, created_at")
    .eq("lead_id", l.id)
    .order("created_at", { ascending: false });
  const messages = (msgs ?? []) as Message[];

  const { data: showingData } = await supabase
    .from("showings")
    .select("id, scheduled_at, outcome")
    .eq("lead_id", l.id)
    .order("scheduled_at", { ascending: false });
  const showings = (showingData ?? []) as Showing[];

  const org = await getCurrentOrg();
  const timeZone = org?.booking_timezone ?? "America/Toronto";
  // "Today" in the org's timezone as YYYY-MM-DD (en-CA formats that way).
  const today = new Date().toLocaleDateString("en-CA", { timeZone });

  const sourceDisplay = resolveLeadSource({
    source: l.source,
    source_detail: l.source_detail,
    post: l.listing_post,
  });
  const followStatus = followUpStatus(l.next_action_at, today);
  const followText = followUpLabel(l.next_action_at, today);
  const quickStages = suggestedNextStageOptions(l.status);

  return (
    <div>
      <Link href="/dashboard/leads" className="text-sm font-medium text-brand">
        ← Inquiries
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {l.name || l.email || "Unnamed renter"}
          </h2>
          <p className="text-sm text-gray-500">
            Received {new Date(l.created_at).toLocaleString()}
            {sourceDisplay ? (
              <>
                {" · via "}
                {sourceDisplay.url ? (
                  <a
                    href={sourceDisplay.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand hover:underline"
                  >
                    {sourceDisplay.label}
                  </a>
                ) : (
                  <span className="font-medium text-gray-600">
                    {sourceDisplay.label}
                  </span>
                )}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-400">
            Stage
          </span>
          <StatusSelect leadId={l.id} status={l.status} />
        </div>
      </div>

      {/* Quick stage moves — one click to the likely next stages. */}
      {quickStages.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-400">
            Quick move
          </span>
          {quickStages.map((q) => (
            <form key={q.stage} action={updateLeadStatus}>
              <input type="hidden" name="id" value={l.id} />
              <input type="hidden" name="status" value={q.stage} />
              <button
                type="submit"
                className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                  q.stage === "lost"
                    ? "border-gray-300 bg-white text-gray-500 hover:bg-gray-50"
                    : "border-brand/30 bg-brand/5 text-brand hover:bg-brand/10"
                }`}
              >
                {q.stage === "new" ? "Reopen" : `→ ${q.label}`}
              </button>
            </form>
          ))}
        </div>
      )}

      {/* Follow-up reminder. */}
      <FollowUp
        leadId={l.id}
        status={followStatus}
        text={followText}
        date={l.next_action_at}
        note={l.next_action_note}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Email"
          value={l.email}
          href={l.email ? `mailto:${l.email}` : undefined}
          external
        />
        <Field
          label="Phone"
          value={l.phone}
          href={l.phone ? `tel:${l.phone}` : undefined}
          external
        />
        <Field
          label="Property"
          value={l.property?.address ?? null}
          href={
            l.property ? `/dashboard/properties/${l.property.id}` : undefined
          }
        />
        <Field
          label="Desired move-in"
          value={l.move_in ? new Date(l.move_in).toLocaleDateString() : null}
        />
      </div>

      {l.notes && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-500">
            Inquiry message
          </h3>
          <p className="whitespace-pre-wrap text-sm text-gray-700">{l.notes}</p>
        </div>
      )}

      {showings.length > 0 && (
        <>
          <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Showings
          </h3>
          <ul className="space-y-2">
            {showings.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <span className="text-sm font-medium text-gray-900">
                  {s.scheduled_at
                    ? new Date(s.scheduled_at).toLocaleString("en-US", {
                        timeZone,
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short",
                      })
                    : "Time TBD"}
                </span>
                <OutcomeSelect showingId={s.id} outcome={s.outcome} />
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-gray-500">
        Activity
      </h3>

      <form
        action={addNote}
        className="mb-5 rounded-lg border border-gray-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={l.id} />
        <textarea
          name="body"
          rows={2}
          required
          placeholder="Log a call, an email you sent, or a note…"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 text-right">
          <button
            type="submit"
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
          >
            Add note
          </button>
        </div>
      </form>

      {messages.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
          No activity yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className="rounded-lg border border-gray-200 bg-white px-4 py-3"
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
                <span className="font-medium uppercase tracking-wider">
                  {m.channel ?? "note"}
                </span>
                <span>·</span>
                <span>{m.direction ?? ""}</span>
                <span>·</span>
                <span>{new Date(m.created_at).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {m.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FOLLOW_STYLES: Record<
  Exclude<FollowUpStatus, "none">,
  { wrap: string; chip: string }
> = {
  overdue: {
    wrap: "border-red-200 bg-red-50",
    chip: "bg-red-100 text-red-700",
  },
  today: {
    wrap: "border-amber-200 bg-amber-50",
    chip: "bg-amber-100 text-amber-700",
  },
  upcoming: {
    wrap: "border-gray-200 bg-white",
    chip: "bg-gray-100 text-gray-600",
  },
};

function FollowUp({
  leadId,
  status,
  text,
  date,
  note,
}: {
  leadId: string;
  status: FollowUpStatus;
  text: string;
  date: string | null;
  note: string | null;
}) {
  const isSet = status !== "none";
  const styles = isSet ? FOLLOW_STYLES[status] : FOLLOW_STYLES.upcoming;

  return (
    <div className={`mt-4 rounded-lg border p-4 ${styles.wrap}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Follow-up
          </span>
          {isSet ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${styles.chip}`}
            >
              {text}
            </span>
          ) : (
            <span className="text-sm text-gray-400">None scheduled</span>
          )}
        </div>
        {isSet && (
          <form action={clearNextAction}>
            <input type="hidden" name="id" value={leadId} />
            <button
              type="submit"
              className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
            >
              Mark done
            </button>
          </form>
        )}
      </div>

      {isSet && note && (
        <p className="mt-2 text-sm text-gray-700">{note}</p>
      )}

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium text-brand">
          {isSet ? "Edit follow-up" : "Schedule a follow-up"}
        </summary>
        <form action={setNextAction} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={leadId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Follow up on
              </span>
              <input
                type="date"
                name="next_action_at"
                defaultValue={date ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-500">
                Note (optional)
              </span>
              <input
                type="text"
                name="next_action_note"
                defaultValue={note ?? ""}
                placeholder="Call about parking…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="text-right">
            <button
              type="submit"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
            >
              Save follow-up
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function Field({
  label,
  value,
  href,
  external,
}: {
  label: string;
  value: string | null;
  href?: string;
  external?: boolean;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-gray-900">
        {value ? (
          href ? (
            external ? (
              <a href={href} className="text-brand hover:underline">
                {value}
              </a>
            ) : (
              <Link href={href} className="text-brand hover:underline">
                {value}
              </Link>
            )
          ) : (
            value
          )
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </div>
    </div>
  );
}
