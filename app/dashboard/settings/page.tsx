import { getCurrentOrg } from "@/lib/org";
import { DEFAULT_BRAND_COLOR } from "@/lib/branding";
import { updateBranding } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  const color = org.brand_color || DEFAULT_BRAND_COLOR;
  const saved = searchParams.saved === "1";
  const error = searchParams.error;

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900">Branding</h2>
      <p className="mt-1 text-sm text-gray-500">
        These details appear to renters everywhere your brand shows up: your
        dashboard header, your public listing pages, and every automated email
        (inquiry auto-reply, booking confirmation, and showing reminders).
      </p>

      {saved && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Branding saved. Renter-facing pages and emails now use these details.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error === "save"
            ? "Something went wrong saving your changes. Please try again."
            : "Some fields weren't valid. Check the brand color (a hex like #0e8c8c), the logo URL (a full http(s) link, or leave it blank), and the reply-to (a valid email, or leave it blank)."}
        </div>
      )}

      <form
        action={updateBranding}
        className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        {/* Editable fields */}
        <div className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Brand details
          </h3>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Business name
            </span>
            <input
              name="name"
              type="text"
              required
              maxLength={120}
              defaultValue={org.name}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-400">
              Shown as the sender name and sign-off in every email to renters.
            </span>
          </label>

          <label className="mt-5 block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Brand color
            </span>
            <span className="flex items-center gap-3">
              <input
                name="brand_color"
                type="color"
                defaultValue={color}
                className="h-10 w-16 cursor-pointer rounded-lg border border-gray-300 p-1"
              />
              <code className="rounded bg-gray-100 px-2 py-1 text-sm text-gray-700">
                {color}
              </code>
            </span>
            <span className="mt-1 block text-xs text-gray-400">
              Used for the header bar, listing accents, and the email accent
              stripe.
            </span>
          </label>

          <label className="mt-5 block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Logo URL
            </span>
            <input
              name="logo_url"
              type="url"
              inputMode="url"
              placeholder="https://example.com/logo.png"
              defaultValue={org.logo_url ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-400">
              A full http(s) link to your logo image. Leave blank for no logo.
            </span>
          </label>

          <label className="mt-5 block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Reply-to email
            </span>
            <input
              name="reply_to_email"
              type="email"
              inputMode="email"
              placeholder="leasing@yourcompany.com"
              defaultValue={org.reply_to_email ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-400">
              Where renter replies to your automated emails are delivered. Leave
              blank to use the shared Vacantless inbox.
            </span>
          </label>

          <div className="mt-6 border-t border-gray-100 pt-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
              Renter feedback
            </h3>

            <label className="flex items-start gap-3">
              <input
                name="feedback_enabled"
                type="checkbox"
                defaultChecked={org.feedback_enabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-700">
                  Email a feedback request after each attended showing
                </span>
                <span className="block text-xs text-gray-400">
                  Renters get a one-tap 1–5 star rating link once you mark their
                  showing as Attended. Results show on the showing and in Reports.
                </span>
              </span>
            </label>

            <label className="mt-4 block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                Send delay (hours after the showing)
              </span>
              <input
                name="feedback_delay_hours"
                type="number"
                min={0}
                max={336}
                step={1}
                defaultValue={org.feedback_delay_hours}
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-gray-400">
                How long to wait after the showing time before sending. Default
                is 2 hours.
              </span>
            </label>
          </div>

          <div className="mt-6 text-right">
            <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">
              Save settings
            </button>
          </div>
        </div>

        {/* Live (saved-state) preview */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Preview
          </h3>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <div className="h-1.5" style={{ backgroundColor: color }} />
            <div className="p-4">
              {org.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={org.logo_url}
                  alt={org.name}
                  className="mb-3 max-h-10"
                />
              ) : (
                <div
                  className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {org.name.charAt(0).toUpperCase()}
                </div>
              )}
              <p className="text-sm font-semibold text-gray-900">{org.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                Hi there, thanks for your interest — someone from our team will
                be in touch shortly.
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Reflects your last saved branding. Save changes to update it.
          </p>
        </div>
      </form>

      {/* Read-only account context */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
          Account
        </h3>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">Plan</dt>
            <dd className="font-medium text-gray-900">{org.plan}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Listing link prefix</dt>
            <dd className="font-medium text-gray-900">/r/&hellip;</dd>
          </div>
          <div>
            <dt className="text-gray-500">Workspace ID</dt>
            <dd className="font-mono text-xs text-gray-600">{org.slug}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-gray-400">
          {org.reply_to_email
            ? `Renter replies to automated emails are delivered to ${org.reply_to_email}.`
            : "Renter replies to automated emails route to the shared Vacantless inbox. Set a reply-to email above to receive them directly."}
        </p>
      </div>
    </div>
  );
}
