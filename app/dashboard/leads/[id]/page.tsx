import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { statusLabel, type LeadStatus } from "@/lib/pipeline";
import { StatusSelect } from "../status-select";
import { addNote } from "../actions";
import { OutcomeSelect } from "../../showings/outcome-select";

export const dynamic = "force-dynamic";

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
  created_at: string;
  property: { id: string; address: string } | null;
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
      "id, name, email, phone, source, source_detail, status, notes, move_in, created_at, property:properties(id, address)",
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

  return (
    <div>
      <Link href="/dashboard/leads" className="text-sm font-medium text-brand">
        ← Leads
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {l.name || l.email || "Unnamed lead"}
          </h2>
          <p className="text-sm text-gray-500">
            Received {new Date(l.created_at).toLocaleString()}
            {l.source ? ` · via ${l.source}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-gray-400">
            Stage
          </span>
          <StatusSelect leadId={l.id} status={l.status} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Email" value={l.email} />
        <Field label="Phone" value={l.phone} />
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

function Field({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-sm text-gray-900">
        {value ? (
          href ? (
            <Link href={href} className="text-brand hover:underline">
              {value}
            </Link>
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
