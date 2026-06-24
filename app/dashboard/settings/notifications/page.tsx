import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { SettingsTabs } from "@/components/settings-tabs";
import { getCurrentOrg } from "@/lib/org";
import { currentUserCan } from "@/lib/membership";
import { createClient } from "@/lib/supabase/server";
import {
  activeNotificationEvents,
  notificationFamilyLabel,
  type NotificationEvent,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { saveNotificationSetting } from "./actions";

// Settings → Notifications (Slice 6 substrate, S327). The operator surface to
// turn each transition notification on/off, edit its copy, and set extra
// recipients. Some operators work entirely in the portal (toggle the email off);
// others (e.g. Aaliyah) work FROM their inbox, so the operator-facing emails
// carry a deep link back into the dashboard. Defaults are baked into the code —
// a blank field here means "use the default", so an empty config still sends the
// right email to the right people.

export const dynamic = "force-dynamic";

const AUDIENCE_HINT: Record<NotificationEvent["audience"], string> = {
  operator:
    "Goes to your team. If you leave recipients empty, it goes to members who manage maintenance.",
  trade:
    "Always goes to the trade on the job. Anyone you add below is cc'd as well.",
  tenant:
    "Always goes to the tenant who reported it. Anyone you add below is cc'd as well.",
};

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
    case "save":
      return "Something went wrong saving. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export default async function NotificationsSettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string; ev?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (!(await currentUserCan("manage_settings"))) {
    redirect("/dashboard/settings?forbidden=1");
  }

  const supabase = createClient();
  const { data: rows } = await supabase
    .from("notification_settings")
    .select("event_key, enabled, subject_template, body_template, recipients")
    .eq("organization_id", org.id);
  const byKey = new Map<string, NotificationSettingRow>();
  for (const r of (rows ?? []) as NotificationSettingRow[]) byKey.set(r.event_key, r);

  // Group active events by family for display.
  const events = activeNotificationEvents();
  const families = [...new Set(events.map((e) => e.family))];

  const savedKey = searchParams.saved;
  const errMsg = errorBanner(searchParams.error);

  return (
    <div>
      <PageHeader
        icon={<Icons.chat />}
        title="Settings"
        subtitle="Choose which updates send automatically, who receives them, and what they say."
      />

      <SettingsTabs active="notifications" />

      <div className="mt-6 space-y-6">
        {errMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {errMsg}
          </div>
        )}
        {savedKey && !errMsg && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            Notification saved.
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
          Each update below can be turned off, re-worded, and sent to extra
          people. Leave the subject or message blank to use the built-in wording.
          Use <code className="rounded bg-white px-1 py-0.5 text-gray-800">{"{{token}}"}</code>{" "}
          placeholders — they're filled in automatically when the email is sent.
        </div>

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
                        <p className="mt-1 text-sm text-gray-600">{event.description}</p>
                      </div>
                      <label className="flex shrink-0 items-center gap-2 text-sm text-gray-700">
                        <input
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
                        <label className="block text-sm font-medium text-gray-700">
                          Subject
                        </label>
                        <input
                          type="text"
                          name="subject_template"
                          defaultValue={row?.subject_template ?? ""}
                          placeholder={event.defaultSubject}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-brand"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          Message
                        </label>
                        <textarea
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
                        <label className="block text-sm font-medium text-gray-700">
                          {event.audience === "operator" ? "Recipients" : "Also send to (cc)"}
                        </label>
                        <textarea
                          name="recipients"
                          defaultValue={recipients}
                          placeholder={"name@example.com\nanother@example.com"}
                          rows={2}
                          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand focus:ring-brand"
                        />
                        <p className="mt-1.5 text-xs text-gray-500">
                          {AUDIENCE_HINT[event.audience]} One address per line (or comma-separated).
                        </p>
                      </div>
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
