import Link from "next/link";
import { headers } from "next/headers";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_BRAND_COLOR } from "@/lib/branding";
import { accessibleBrand, isBrandColorTooLight } from "@/lib/brand-theme";
import {
  updateBranding,
  sendTestEmailAction,
  uploadOrgLogo,
  removeOrgLogo,
} from "./actions";
import { logoUploadErrorMessage } from "@/lib/logo";
import { PageHeader, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: {
    saved?: string;
    error?: string;
    test?: string;
    to?: string;
    logo?: string;
    logoerr?: string;
  };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  // Most-recent property (if any) powers the "View public renter page" link —
  // a one-click way to see exactly what renters get from the shared intake URL.
  const supabase = createClient();
  const { data: propertyRows } = await supabase
    .from("properties")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);
  const firstPropertyId = (propertyRows as { id: string }[] | null)?.[0]?.id;

  // The signed-in operator's own email prefills the test-send recipient — the
  // common case is "send it to me so I can see what renters get".
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const operatorEmail = user?.email ?? "";

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const renterPageUrl = firstPropertyId
    ? host
      ? `${proto}://${host}/r/${firstPropertyId}`
      : `/r/${firstPropertyId}`
    : null;

  const color = org.brand_color || DEFAULT_BRAND_COLOR;
  // The preview mirrors what renters actually see: the dashboard header and
  // public pages use an accessibility-guardrailed (darkened-as-needed) variant
  // so white text stays readable on a pale color.
  const displayColor = accessibleBrand(color);
  const wasDarkened = isBrandColorTooLight(color);
  const saved = searchParams.saved === "1";
  const error = searchParams.error;
  const test = searchParams.test;
  const testedTo = searchParams.to;
  const logoSaved = searchParams.logo === "saved";
  const logoRemoved = searchParams.logo === "removed";
  const logoErr = searchParams.logoerr;
  const logoErrMsg =
    logoErr === "empty" || logoErr === "type" || logoErr === "size"
      ? logoUploadErrorMessage(logoErr)
      : logoErr
        ? "Something went wrong uploading your logo. Please try again."
        : null;

  return (
    <div>
      <PageHeader
        icon={<Icons.settings />}
        title="Settings"
        subtitle="Control how your brand appears to renters and how automated emails and texts behave."
      />

      {saved && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Branding saved. Renter-facing pages and emails now use these details.
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error === "save"
            ? "Something went wrong saving your changes. Please try again."
            : "Some fields weren't valid. Check the brand color (a hex like #0e8c8c) and the reply-to (a valid email, or leave it blank)."}
        </div>
      )}

      {logoSaved && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Logo updated. It now appears on your public pages and emails.
        </div>
      )}
      {logoRemoved && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          Logo removed. Your business name shows in its place.
        </div>
      )}
      {logoErrMsg && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {logoErrMsg}
        </div>
      )}

      {test === "sent" && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Test email sent{testedTo ? ` to ${testedTo}` : ""}. Check your inbox
          (and spam folder) to see exactly what renters receive.
        </div>
      )}
      {test === "invalid" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Please enter a valid email address to send the test to.
        </div>
      )}
      {test === "nokey" && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Email sending isn&apos;t connected yet, so the test couldn&apos;t go
          out. Your branded emails will start sending automatically once email
          is enabled on your account.
        </div>
      )}
      {test === "failed" && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Something went wrong sending the test email. Please try again in a
          moment.
        </div>
      )}

      <form
        action={updateBranding}
        className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3"
      >
        {/* Editable fields */}
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <IconTile size="sm"><Icons.bolt className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Brand details
            </h3>
          </div>

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

          <div className="mt-6 border-t border-gray-100 pt-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
              Automatic follow-up
            </h3>

            <label className="flex items-start gap-3">
              <input
                name="nurture_enabled"
                type="checkbox"
                defaultChecked={org.nurture_enabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-700">
                  Automatically follow up with renters who haven&apos;t booked
                </span>
                <span className="block text-xs text-gray-400">
                  Sends a gentle, branded sequence of up to 3 reminders (around 2,
                  5, and 10 days after the inquiry) inviting them to book a
                  showing. It stops automatically the moment a renter books, is
                  marked lost, or moves further along.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-6 border-t border-gray-100 pt-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
              Text message reminders
            </h3>

            <label className="flex items-start gap-3">
              <input
                name="sms_enabled"
                type="checkbox"
                defaultChecked={org.sms_enabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-700">
                  Also text renters their booking confirmation and showing
                  reminders
                </span>
                <span className="block text-xs text-gray-400">
                  When a renter leaves a phone number, we send a short text
                  confirming their booking and reminders about 24 hours and 2
                  hours before the showing, alongside the emails. Every text
                  includes &quot;Reply STOP to opt out,&quot; and a renter who
                  replies STOP is never texted again. Texting starts once your
                  account&apos;s SMS is connected.
                </span>
              </span>
            </label>
          </div>

        </div>

        {/* Live (saved-state) preview */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Preview
            </h3>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200">
            {/* Mini renter header — white text on the brand, exactly as renters see it */}
            <div
              className="flex items-center gap-2 px-4 py-3 text-white"
              style={{ backgroundColor: displayColor }}
            >
              {org.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={org.logo_url} alt={org.name} className="max-h-7" />
              ) : (
                <span className="text-sm font-bold">{org.name}</span>
              )}
            </div>
            <div className="p-4">
              <p className="text-sm font-semibold text-gray-900">{org.name}</p>
              <p className="mt-1 text-xs text-gray-500">
                Hi there, thanks for your interest. Someone from our team will
                be in touch shortly.
              </p>
              <span
                className="mt-3 inline-flex rounded-lg px-3 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: displayColor }}
              >
                Book a showing
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Reflects your last saved branding. Save changes to update it.
          </p>
          {wasDarkened && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Your brand color is light, so we use a slightly darker shade
              ({displayColor}) behind white text (your header, buttons, and
              links) to keep it readable. Your exact color is saved.
            </p>
          )}
        </div>

        {/* Sticky save bar — stays in view while you scroll the form */}
        <div className="sticky bottom-4 lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
            <p className="text-xs text-gray-500">
              Changes apply to your renter-facing pages and emails as soon as
              you save.
            </p>
            <button className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
              Save changes
            </button>
          </div>
        </div>
      </form>

      {/* Logo — uploaded to storage; sets the image on the public page + emails */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Logo
            </h3>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Shown on your public listing pages and at the top of every email to
            renters. Use a PNG, JPG, WebP, GIF, or SVG up to 2 MB.
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="flex h-16 w-40 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-3">
              {org.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={org.logo_url}
                  alt={org.name}
                  className="max-h-12 max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-gray-400">No logo yet</span>
              )}
            </div>

            <form
              action={uploadOrgLogo}
              encType="multipart/form-data"
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                required
                className="text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
              />
              <button className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Upload
              </button>
            </form>
          </div>

          {org.logo_url && (
            <form action={removeOrgLogo} className="mt-3">
              <button className="text-xs font-medium text-red-600 hover:text-red-700">
                Remove logo
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Send a test email — confirm branding + deliverability before going live */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2.5">
          <IconTile size="sm"><Icons.mail className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Send a test email
          </h3>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Email yourself a copy of the renter auto-reply with your current
          branding (name, color, logo, and reply-to) so you can see exactly what
          renters receive before you share your listing link.
        </p>
        <form
          action={sendTestEmailAction}
          className="mt-4 flex flex-wrap items-end gap-3"
        >
          <label className="block flex-1 min-w-[16rem]">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Send to
            </span>
            <input
              name="test_email"
              type="email"
              inputMode="email"
              required
              placeholder="you@yourcompany.com"
              defaultValue={operatorEmail}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
            Send test email
          </button>
        </form>
        <p className="mt-3 text-xs text-gray-400">
          The test uses sample renter and listing details. Save your branding
          changes first so the test reflects them.
        </p>
      </div>

      {/* Read-only account context */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <IconTile size="sm"><Icons.key className="h-4 w-4" /></IconTile>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              Account
            </h3>
          </div>
          {renterPageUrl ? (
            <Link
              href={renterPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              View public renter page ↗
            </Link>
          ) : (
            <span className="text-xs text-gray-400">
              Add a property to preview your public renter page.
            </span>
          )}
        </div>
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
            <dt className="text-gray-500">Account ID</dt>
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
