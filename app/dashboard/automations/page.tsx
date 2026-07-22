import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import {
  activeNotificationEvents,
  notificationFamilyLabel,
  type NotificationEvent,
  type NotificationLane,
  type NotificationSettingRow,
} from "@/lib/notifications";
import {
  summarizeReminderLog,
  type ComplianceReminderLogRow,
  type ReminderLogSummary,
} from "@/lib/compliance-calendar";
import { AccentColorField } from "@/components/accent-color-field";
import { saveNotificationSetting, saveNotificationLane } from "./actions";

// The operator lanes (S554), in display order. Each label names WHO handles that
// kind of alert; the helper copy on the card explains how the fallback works.
const LANES: { lane: NotificationLane; label: string; hint: string }[] = [
  {
    lane: "showing",
    label: "Showing operator",
    hint: "Handles the inquiry-to-lease funnel: new leads, viewings, showings, availability, and the daily leasing summary.",
  },
  {
    lane: "listing",
    label: "Listing operator",
    hint: "Handles getting units advertised: listing health, syndication, and done-for-you posting.",
  },
  {
    lane: "owner",
    label: "Owner / landlord",
    hint: "Handles landlord reminders: rent increases, insurance, detector and equipment end-of-life, inspections, and other compliance.",
  },
];
const LANE_LABEL: Record<NotificationLane, string> = {
  showing: "Showing operator",
  listing: "Listing operator",
  owner: "Owner / landlord",
};

// Global fallback when an event has no code default accent and the org has no
// brand color set — keeps the color picker seeded with a valid hex.
const DEFAULT_ACCENT = "#0f172a";

// Automations & Templates (Slice 6 substrate, S327). The operator surface to
// turn each transition notification on/off, edit its copy, and set extra
// recipients. Some operators work entirely in the portal (toggle the email off);
// others (e.g. Aaliyah) work FROM their inbox, so the operator-facing emails
// carry a deep link back into the dashboard. Defaults are baked into the code —
// a blank field here means "use the default", so an empty config still sends the
// right email to the right people.

export const dynamic = "force-dynamic";

// The TRUE inquiry/viewing operator events - a new inquiry, the post-showing
// outcome nudge, and the daily leads/showings digest. These are the only leasing
// operator events whose empty-recipients fallback should read "members who manage
// inquiries". The rest of the `leasing` family that reaches an operator is
// landlord/compliance/asset reminders (rent increase, insurance review, detector /
// equipment EOL, appliance warranty, inspections, ...) which do NOT route through
// inquiry managers - those take the neutral "manage this account" hint.
const INQUIRY_OPERATOR_EVENTS = new Set<string>([
  "leasing.new_lead",
  "leasing.showing_outcome_nudge",
  "leasing.daily_snapshot",
]);

// Hint under the recipients field. For operator events the default-recipient
// wording is EVENT-aware, not just family-aware: dispatch (maintenance) events say
// "manage maintenance"; genuine inquiry/viewing events say "manage inquiries"; every
// other leasing operator event (compliance/asset/landlord reminders) uses a neutral
// team hint so it never implies compliance reminders route to inquiry managers.
// trade/tenant hints are audience-only and unchanged.
function audienceHint(event: NotificationEvent): string {
  switch (event.audience) {
    case "operator":
      if (event.family === "dispatch") {
        return "Goes to your team. If you leave recipients empty, it goes to members who manage maintenance.";
      }
      // S554: a leasing operator event with a lane falls back to that lane's
      // recipients (set once at the top) before the capability-member default.
      if (event.lane) {
        const memberHint = INQUIRY_OPERATOR_EVENTS.has(event.key)
          ? "members who manage inquiries"
          : "members who manage this account";
        return `Goes to your team. If you leave recipients empty, it uses your ${LANE_LABEL[event.lane]} lane (set at the top), then falls back to ${memberHint}.`;
      }
      return INQUIRY_OPERATOR_EVENTS.has(event.key)
        ? "Goes to your team. If you leave recipients empty, it goes to members who manage inquiries."
        : "Goes to your team. If you leave recipients empty, it goes to members who manage this account.";
    case "trade":
      return "Always goes to the trade on the job. Anyone you add below is cc'd as well.";
    case "tenant":
      return "Always goes to the tenant who reported it. Anyone you add below is cc'd as well.";
  }
}

// Format a compliance_reminder_log sent_at for the "Last reminded" line, in the
// org's booking timezone so it matches the operator's calendar (falls back to
// Toronto, then to a tz-less render if Intl rejects the zone).
function formatReminderDate(iso: string, tz?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };
  try {
    return d.toLocaleDateString("en-CA", { ...opts, timeZone: tz || "America/Toronto" });
  } catch {
    return d.toLocaleDateString("en-CA", opts);
  }
}

function errorBanner(code: string | undefined): string | null {
  switch (code) {
    case undefined:
    case "":
      return null;
    case "forbidden":
      return "You don't have permission to change notification settings.";
    case "unknown":
      return "That notification could not be found.";
    case "bad_email":
      return "One of the recipient addresses isn't a valid email. Please fix it and save again.";
    case "too_many":
      return "That's too many recipients. Please keep the list to 20 addresses or fewer.";
    case "bad_color":
      return "The accent color isn't a valid hex value (like #dc2626). Please fix it and save again.";
    case "save":
      return "Something went wrong saving. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: { saved?: string; saved_lane?: string; error?: string; ev?: string; lane?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!(await currentUserCan("manage_settings"))) {
    redirect("/dashboard/settings?forbidden=1");
  }

  const supabase = createClient();
  const { data: rows } = await supabase
    .from("notification_settings")
    .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
    .eq("organization_id", org.id);
  const byKey = new Map<string, NotificationSettingRow>();
  for (const r of (rows ?? []) as NotificationSettingRow[]) byKey.set(r.event_key, r);

  // The org's operator-lane recipient lists (S554). Absent lane == empty box ==
  // fall back to the capability default. Defensive: a null/errored read (e.g. a
  // deploy that landed before migration 0179) just yields empty lanes.
  const { data: laneRows } = await supabase
    .from("org_notification_lanes")
    .select("lane, recipients")
    .eq("organization_id", org.id);
  const laneByKey = new Map<string, string[]>();
  for (const r of (laneRows ?? []) as { lane: string; recipients: string[] }[]) {
    laneByKey.set(r.lane, r.recipients ?? []);
  }

  // "Last reminded" view over the landlord-notify compliance log (0079). RLS
  // scopes the rows to this org; summarizeReminderLog seeds every landlord-notify
  // event (so never-fired ones still show the line) and folds in the newest send
  // per event. Only those events appear in the map, so the per-card line shows
  // exactly on the annual landlord reminders.
  const { data: reminderRows } = await supabase
    .from("compliance_reminder_log")
    .select("event_key, sent_at")
    .eq("organization_id", org.id)
    .order("sent_at", { ascending: false });
  const reminderByKey = new Map<string, ReminderLogSummary>();
  for (const s of summarizeReminderLog((reminderRows ?? []) as ComplianceReminderLogRow[])) {
    reminderByKey.set(s.eventKey, s);
  }

  // "Default recipients today" for the new-inquiry alert (P3, post-S402): show
  // the landlord the exact address(es) that receive the first real inquiry when
  // they've left the recipients field blank. Resolved the SAME way the send path
  // does (leasing-role member emails, else reply-to / public contact), so the
  // preview can't drift from what actually happens. Best-effort: needs the admin
  // client to read member auth emails; without it we show a generic description.
  let newLeadDefaultRecipients: string[] = [];
  const admin = createAdminClient();
  if (admin) {
    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", org.id);
    const members: { role: string | null; email: string | null }[] = [];
    for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      members.push({ role: m.role, email: u?.user?.email ?? null });
    }
    newLeadDefaultRecipients = resolveLeadNotifyEmailsPreferMemberFallback(members, [
      org.reply_to_email,
      org.public_contact_email,
    ]);
  }

  // Group active events by family for display.
  const events = activeNotificationEvents();
  const families = [...new Set(events.map((e) => e.family))];

  const savedKey = searchParams.saved;
  const savedLane = searchParams.saved_lane;
  const errMsg = errorBanner(searchParams.error);

  return (
    <div>
      <PageHeader
        icon={<Icons.chat />}
        title="Automations & Templates"
        subtitle="Choose which updates send automatically, who receives them, and what they say."
      />

      <div className="mt-6 space-y-6">
        {errMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errMsg}
          </div>
        )}
        {(savedKey || savedLane) && !errMsg && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            {savedLane ? "Operator lane saved." : "Notification saved."}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Each update below can be turned off, re-worded, and sent to extra
          people. Leave the subject or message blank to use the built-in wording.
          Use <code className="rounded bg-white px-1 py-0.5 text-gray-800">{"{{token}}"}</code>{" "}
          placeholders — they&apos;re filled in automatically when the email is sent.
        </div>

        {/* Operator lanes (S554): set who handles each KIND of alert once. Any
            event below with its own recipients still overrides its lane. */}
        <section className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              Who handles each alert
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Set who handles each kind of alert once here. Any event below with
              its own recipients still overrides its lane. Leave a lane empty to
              fall back to your team members.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {LANES.map(({ lane, label, hint }) => {
              const current = (laneByKey.get(lane) ?? []).join("\n");
              const laneFieldId = `lane-${lane}-recipients`;
              const highlight = savedLane === lane;
              return (
                <form
                  key={lane}
                  action={saveNotificationLane}
                  className={[
                    "flex flex-col rounded-xl border bg-white p-5 shadow-sm",
                    highlight ? "border-brand" : "border-gray-200",
                  ].join(" ")}
                >
                  <input type="hidden" name="lane" value={lane} />
                  <label
                    htmlFor={laneFieldId}
                    className="block text-base font-semibold text-gray-900"
                  >
                    {label}
                  </label>
                  <p className="mt-1 text-xs text-gray-500">{hint}</p>
                  <textarea
                    id={laneFieldId}
                    name="recipients"
                    defaultValue={current}
                    placeholder={"name@example.com\nanother@example.com"}
                    rows={3}
                    className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-brand"
                  />
                  <p className="mt-1.5 text-xs text-gray-500">
                    One address per line (or comma-separated). Empty falls back to
                    your team members.
                  </p>
                  <div className="mt-3 flex justify-end">
                    <button
                      type="submit"
                      className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                    >
                      Save
                    </button>
                  </div>
                </form>
              );
            })}
          </div>
        </section>

        {families.map((family) => (
          <section key={family} className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
              {notificationFamilyLabel(family)}
            </h2>

            {events
              .filter((e) => e.family === family)
              .map((event) => {
                const row = byKey.get(event.key) ?? null;
                const enabled = row ? row.enabled : true;
                const recipients = (row?.recipients ?? []).join("\n");
                const highlight = savedKey === event.key;
                const fieldIdPrefix = `notification-${event.key.replace(
                  /[^a-zA-Z0-9_-]/g,
                  "-",
                )}`;
                const enabledId = `${fieldIdPrefix}-enabled`;
                const subjectId = `${fieldIdPrefix}-subject`;
                const bodyId = `${fieldIdPrefix}-body`;
                const recipientsId = `${fieldIdPrefix}-recipients`;
                return (
                  <form
                    key={event.key}
                    action={saveNotificationSetting}
                    className={[
                      "rounded-xl border bg-white p-5 shadow-sm",
                      highlight ? "border-brand" : "border-gray-200",
                    ].join(" ")}
                  >
                    <input type="hidden" name="event_key" value={event.key} />

                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-gray-900">
                          {event.label}
                        </h3>
                        {event.lane && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            Lane: {LANE_LABEL[event.lane]}
                          </span>
                        )}
                        <p className="mt-1 text-sm text-gray-600">{event.description}</p>
                        {reminderByKey.has(event.key) && (
                          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                            {reminderByKey.get(event.key)!.lastSentAt
                              ? `Last reminded ${formatReminderDate(
                                  reminderByKey.get(event.key)!.lastSentAt!,
                                  org.booking_timezone,
                                )}`
                              : "Not sent yet — sends once a year when it's due"}
                          </p>
                        )}
                      </div>
                      <label
                        htmlFor={enabledId}
                        className="flex shrink-0 items-center gap-2 text-sm text-gray-700"
                      >
                        <input
                          id={enabledId}
                          type="checkbox"
                          name="enabled"
                          defaultChecked={enabled}
                          className="h-4 w-4 rounded border-gray-300 text-brand focus:ring-brand"
                        />
                        On
                      </label>
                    </div>

                    <div className="mt-4 space-y-4">
                      <div>
                        <label
                          htmlFor={subjectId}
                          className="block text-sm font-medium text-gray-700"
                        >
                          Subject
                        </label>
                        <input
                          id={subjectId}
                          type="text"
                          name="subject_template"
                          defaultValue={row?.subject_template ?? ""}
                          placeholder={event.defaultSubject}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-brand"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor={bodyId}
                          className="block text-sm font-medium text-gray-700"
                        >
                          Message
                        </label>
                        <textarea
                          id={bodyId}
                          name="body_template"
                          defaultValue={row?.body_template ?? ""}
                          placeholder={event.defaultBody}
                          rows={5}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-brand"
                        />
                        <p className="mt-1.5 text-xs text-gray-500">
                          Available placeholders:{" "}
                          {event.tokens.map((t, i) => (
                            <span key={t}>
                              {i > 0 && ", "}
                              <code className="rounded bg-gray-100 px-1 py-0.5 text-gray-700">{`{{${t}}}`}</code>
                            </span>
                          ))}
                        </p>
                      </div>

                      <div>
                        <label
                          htmlFor={recipientsId}
                          className="block text-sm font-medium text-gray-700"
                        >
                          {event.audience === "operator" ? "Recipients" : "Also send to (cc)"}
                        </label>
                        <textarea
                          id={recipientsId}
                          name="recipients"
                          defaultValue={recipients}
                          placeholder={"name@example.com\nanother@example.com"}
                          rows={2}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-brand"
                        />
                        <p className="mt-1.5 text-xs text-gray-500">
                          {audienceHint(event)} One address per line (or comma-separated).
                        </p>
                        {event.key === "leasing.new_lead" &&
                          (() => {
                            const configured = row?.recipients ?? [];
                            const resolvedToday =
                              configured.length > 0
                                ? configured
                                : newLeadDefaultRecipients;
                            return (
                              <p className="mt-1.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                <span className="font-medium">
                                  Default recipients today:
                                </span>{" "}
                                {resolvedToday.length > 0
                                  ? resolvedToday.join(", ")
                                  : "your leasing team members and your reply-to email"}
                                {configured.length === 0 && (
                                  <span className="text-gray-400">
                                    {" "}
                                    (from your team and reply-to — add addresses
                                    above to change this)
                                  </span>
                                )}
                              </p>
                            );
                          })()}
                      </div>

                      {event.key === "leasing.showing_outcome_nudge" && (
                        <div>
                          <label
                            htmlFor={`${fieldIdPrefix}-cadence`}
                            className="block text-sm font-medium text-gray-700"
                          >
                            How often to remind
                          </label>
                          <select
                            id={`${fieldIdPrefix}-cadence`}
                            name="outcome_nudge_max"
                            defaultValue={String(org.outcome_nudge_max ?? 3)}
                            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-brand"
                          >
                            <option value="1">Just once</option>
                            <option value="3">Follow up until answered</option>
                          </select>
                          <p className="mt-1.5 text-xs text-gray-500">
                            Reminders stop the moment the outcome is recorded. To
                            turn them off entirely, use the On switch above.
                          </p>
                        </div>
                      )}

                      <AccentColorField
                        name="accent_color"
                        saved={row?.accent_color ?? ""}
                        fallback={
                          event.defaultAccent ?? org.brand_color ?? DEFAULT_ACCENT
                        }
                      />
                    </div>

                    <div className="mt-4 flex justify-end">
                      <button
                        type="submit"
                        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                );
              })}
          </section>
        ))}
      </div>
    </div>
  );
}
