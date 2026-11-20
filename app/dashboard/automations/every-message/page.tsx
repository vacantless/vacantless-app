import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { activeNotificationEvents } from "@/lib/notifications";
import {
  CATALOG_MESSAGES,
  MESSAGE_GROUPS,
  channelLabel,
  EVENT_INCLUDES,
  eventGoesTo,
  eventGroup,
  eventIsOn,
  isDraftOnlyEvent,
  type CatalogMessage,
  type MessageGroup,
  type MessageOrgSwitch,
} from "@/lib/message-catalog";
import { saveMessageSwitch } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Every message we send", robots: { index: false, follow: false } };

// S824e: every email, text and call message, grouped by who gets it, with when
// it goes out and its live on/off state. The list is lib/message-catalog.ts
// plus the notification events; scripts/test-s824e-message-catalog.ts fails if
// a send in the code is missing, so nothing goes out that is not on this page.

type OrgSwitchRow = Record<MessageOrgSwitch, boolean | null> & {
  sms_enabled: boolean | null;
  auto_release_unconfirmed_enabled: boolean | null;
  auto_release_unconfirmed_hours: number | null;
  feedback_delay_hours: number | null;
};

type State = "on" | "off" | "button" | "draft";

type Row = {
  id: string;
  title: string;
  when: string;
  goesTo: string;
  includes?: string;
  channels: CatalogMessage["channels"];
  state: State;
  textOff: boolean;
  action:
    | { kind: "switch"; column: MessageOrgSwitch; on: boolean }
    | { kind: "link"; href: string; label: string }
    | { kind: "none" };
};

const STATE_LABEL: Record<State, string> = {
  on: "On",
  off: "Off",
  button: "When you press it",
  draft: "Drafted for you to send",
};
const STATE_CLASS: Record<State, string> = {
  on: "bg-emerald-50 text-emerald-800",
  off: "bg-gray-100 text-gray-600",
  button: "bg-blue-50 text-blue-800",
  draft: "bg-amber-50 text-amber-800",
};

export default async function EveryMessagePage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/login?next=/dashboard/automations/every-message");
  const canChange = await currentUserCan("manage_settings");
  const supabase = createClient();

  const { data: orgRow } = await supabase
    .from("organizations")
    .select(
      "nurture_enabled, feedback_enabled, feedback_delay_hours, reschedule_nudge_enabled, availability_tripwire_enabled, viewing_reminder_enabled, compliance_calendar_enabled, viewing_times_opened_enabled, sms_enabled, auto_release_unconfirmed_enabled, auto_release_unconfirmed_hours",
    )
    .eq("id", org.id)
    .maybeSingle();
  const o = (orgRow ?? {}) as Partial<OrgSwitchRow>;
  const texting = o.sms_enabled === true;

  const { data: settingRows } = await supabase
    .from("notification_settings")
    .select("event_key, enabled")
    .eq("organization_id", org.id);
  const settingByKey = new Map<string, { enabled: boolean }>();
  for (const r of (settingRows ?? []) as { event_key: string; enabled: boolean }[]) settingByKey.set(r.event_key, r);

  const rowsByGroup = new Map<MessageGroup, Row[]>();
  const push = (g: MessageGroup, r: Row) => rowsByGroup.set(g, [...(rowsByGroup.get(g) ?? []), r]);

  for (const m of CATALOG_MESSAGES) {
    const c = m.control;
    let state: State = "on";
    let action: Row["action"] = { kind: "none" };
    let when = m.when;
    if (c.type === "switch") {
      const on = o[c.column] === true;
      state = on ? "on" : "off";
      action = { kind: "switch", column: c.column, on };
      if (c.column === "feedback_enabled" && typeof o.feedback_delay_hours === "number") {
        when = `${o.feedback_delay_hours} ${o.feedback_delay_hours === 1 ? "hour" : "hours"} after a viewing. Change the wait in Settings.`;
      }
    } else if (c.type === "elsewhere") {
      state = c.column ? (o[c.column] === true ? "on" : "off") : "on";
      action = { kind: "link", href: c.href, label: c.label };
      if (c.column === "auto_release_unconfirmed_enabled" && typeof o.auto_release_unconfirmed_hours === "number") {
        when = `When an unconfirmed viewing is released, ${o.auto_release_unconfirmed_hours} hours ahead of its time.`;
      }
    } else if (c.type === "button") {
      state = "button";
      action = { kind: "none" };
      when = `${m.when} From: ${c.where}.`;
    }
    const textOnly = m.channels.length === 1 && m.channels[0] === "text";
    const callOnly = m.channels.length === 1 && m.channels[0] === "call";
    if ((textOnly || callOnly) && m.textNeedsTexting && !texting && state !== "button") state = "off";
    push(m.group, {
      id: m.id,
      title: m.title,
      when,
      goesTo: m.goesTo,
      includes: m.includes,
      channels: m.channels,
      state,
      textOff: Boolean(m.textNeedsTexting && !texting && m.channels.includes("text") && !textOnly),
      action,
    });
  }

  for (const e of activeNotificationEvents()) {
    const draft = isDraftOnlyEvent(e.key);
    const on = eventIsOn(e, settingByKey.get(e.key));
    push(eventGroup(e), {
      id: `event-${e.key}`,
      title: e.label,
      when: e.description,
      goesTo: eventGoesTo(e),
      includes: EVENT_INCLUDES[e.key],
      channels: ["email"],
      state: !on ? "off" : draft ? "draft" : "on",
      textOff: false,
      action: { kind: "link", href: `/dashboard/automations#event-${e.key}`, label: "Change or edit wording" },
    });
  }

  const all = [...rowsByGroup.values()].flat();
  const count = (s: State) => all.filter((r) => r.state === s).length;

  // S824h: only say "with your arrival note" when a rental has one.
  const { count: noteCount } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id)
    .is("archived_at", null)
    .not("renter_arrival_note", "is", null);
  const noteLine = (noteCount ?? 0) > 0 ? ", with your arrival note" : "";
  const nurtureOn = o.nurture_enabled === true;
  const feedbackOn = o.feedback_enabled === true;
  const week: { when: string; what: string; on: boolean }[] = [
    { when: "Right away", what: "Thanks for your interest, by email", on: true },
    { when: "Day 2 and day 5, if not booked", what: "Follow-ups, by email", on: nurtureOn },
    {
      when: "When they book",
      what: `Viewing booked, by email${texting ? " and text" : ""}${noteLine}`,
      on: true,
    },
    { when: "The day before", what: texting ? "Reminder by email, plus a text if not confirmed" : "Reminder by email", on: true },
    { when: "About 4 hours before", what: texting ? "Reminder by text" : "Reminder by email", on: true },
    {
      when: `${typeof o.feedback_delay_hours === "number" ? o.feedback_delay_hours : 2} hours after`,
      what: "How was your viewing, by email",
      on: feedbackOn,
    },
  ];

  return (
    <div>
      <PageHeader
        icon={<Icons.chat />}
        title="Every message we send"
        subtitle="Who gets what, when, and how. Turn messages on or off here."
      />
      <p className="mb-4 text-sm">
        <Link href="/dashboard/automations" className="font-medium text-brand hover:underline">
          Back to Messages and reminders
        </Link>
      </p>

      {searchParams.error ? (
        <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {searchParams.error === "forbidden" ? "Your sign-in can't change these. Ask the account owner." : "That did not save. Try again."}
        </p>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="On" value={count("on")} />
        <Stat label="Off" value={count("off")} />
        <Stat label="When you press it" value={count("button")} />
        <Stat label="Drafted for you" value={count("draft")} />
      </div>

      <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
        Texting is {texting ? "on" : "off"} for this account.{" "}
        {texting ? "Texts below go out." : "Texts below wait until you turn it on."}{" "}
        <Link href="/dashboard/settings?tab=comms" className="font-medium text-brand hover:underline">
          Texting settings
        </Link>
      </p>

      <section className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">A renter&apos;s week, from first message to viewing</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {week.map((w) => (
            <li key={w.when} className="flex flex-wrap items-baseline gap-x-3">
              <span className="w-56 shrink-0 font-medium text-gray-900">{w.when}</span>
              <span className={w.on ? "text-gray-700" : "text-gray-400 line-through"}>{w.what}</span>
              {!w.on ? <span className="text-xs text-gray-500">Off</span> : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-gray-500">
          Renters can unsubscribe from follow-ups in any email. Replying stop to a text ends texts.
        </p>
      </section>

      <div className="space-y-6">
        {MESSAGE_GROUPS.map(({ group, label, hint }) => {
          const rows = rowsByGroup.get(group) ?? [];
          if (rows.length === 0) return null;
          return (
            <details key={group} open={group === "renters"} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-5 py-4">
                <span className="text-base font-semibold text-gray-900">{label}</span>{" "}
                <span className="text-sm text-gray-500">{rows.length}</span>
                <span className="block text-xs text-gray-500">{hint}</span>
              </summary>
              <ul className="divide-y divide-gray-100 border-t border-gray-100">
                {rows.map((r) => (
                  <li key={r.id} id={r.action.kind === "switch" ? r.action.column : r.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900">{r.title}</p>
                        <p className="mt-0.5 text-gray-600">{r.when}</p>
                        <p className="mt-1 text-xs text-gray-600">
                          <span className="font-medium text-gray-700">Goes to:</span> {r.goesTo}
                        </p>
                        {r.includes ? (
                          <p className="mt-0.5 text-xs text-gray-600">
                            <span className="font-medium text-gray-700">Includes:</span> {r.includes}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-gray-500">
                          {channelLabel(r.channels)}
                          {r.textOff ? ". The text waits until texting is on." : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATE_CLASS[r.state]}`}>
                          {STATE_LABEL[r.state]}
                        </span>
                        {r.action.kind === "switch" && canChange ? (
                          <form action={saveMessageSwitch}>
                            <input type="hidden" name="column" value={r.action.column} />
                            <input type="hidden" name="on" value={r.action.on ? "no" : "yes"} />
                            <button type="submit" className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50">
                              {r.action.on ? "Turn off" : "Turn on"}
                            </button>
                          </form>
                        ) : null}
                        {r.action.kind === "link" ? (
                          <Link href={r.action.href} className="text-xs font-medium text-brand hover:underline">
                            {r.action.label}
                          </Link>
                        ) : null}
                        {searchParams.saved && r.action.kind === "switch" && searchParams.saved === r.action.column ? (
                          <span className="text-xs text-emerald-700">Saved</span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{value}</p>
    </div>
  );
}
