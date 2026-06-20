import Link from "next/link";
import { headers } from "next/headers";
import { getCurrentOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_BRAND_COLOR } from "@/lib/branding";
import {
  accessibleBrand,
  isBrandColorTooLight,
  brandGradientCss,
} from "@/lib/brand-theme";
import {
  updateBrandIdentity,
  updatePublicContact,
  updateEmailSender,
  updateRenterMessages,
  updateTextMessages,
  sendTestEmailAction,
  uploadOrgLogo,
  removeOrgLogo,
} from "./actions";
import { CopyLinkButton } from "@/components/copy-link-button";
import {
  summarizeFeed,
  type FeedListingInput,
  type FeedMissingField,
} from "@/lib/listing-feed";
import { logoUploadErrorMessage } from "@/lib/logo";
import BrandColorField from "@/components/brand-color-field";
import { RenterPagePreview } from "@/components/renter-page-preview";
import { SettingsTabs, type SettingsTab } from "@/components/settings-tabs";
import { PageHeader, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";
import RotessaSettingsCard, {
  type RotessaAccountView,
} from "@/components/rotessa-settings-card";
import StripeConnectSettingsCard, {
  type StripeConnectAccountView,
} from "@/components/stripe-connect-settings-card";
import { encryptionConfigured } from "@/lib/crypto";
import { getStripe } from "@/lib/stripe";
import { saveMessageTemplate, deleteMessageTemplate } from "./comms-actions";
import {
  MESSAGE_CHANNELS,
  channelLabel,
  commsErrorMessage,
} from "@/lib/tenant-comms";

export const dynamic = "force-dynamic";

// Settings is grouped into top tabs (S227 restructure; IA locked in
// VACANTLESS-SETTINGS-USABILITY-AUDIT-2026-06-17.md Section 8). S275 IA Step 3
// slimmed it: screening + building policy + the Lease Clauses tab moved to
// their point-of-use, leaving brand / comms / banking / account. The active tab
// comes from ?tab=, but each section's redirect-based save also carries the
// right tab; for the few flash params that don't (legacy rotessa/stripe/tpl
// redirects), we infer the tab from which flash is present so the user always
// lands back where they were.
function resolveTab(sp: Record<string, string | undefined>): SettingsTab {
  const t = sp.tab;
  if (t === "brand" || t === "comms" || t === "banking" || t === "account") {
    return t;
  }
  if (sp.rotessa || sp.stripeconnect) return "banking";
  if (sp.test || sp.tpl || sp.tn || sp.sender || sp.renter || sp.sms) {
    return "comms";
  }
  // saved / error / logo / logoerr all belong to the brand tab.
  return "brand";
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    saved?: string;
    error?: string;
    test?: string;
    to?: string;
    logo?: string;
    logoerr?: string;
    rotessa?: string;
    stripeconnect?: string;
    reason?: string;
    tpl?: string;
    tn?: string; // post-submit nonce that remounts the new-template form (reset)
    sender?: string; // Communications → Email sender flash
    renter?: string; // Communications → Renter messages flash
    sms?: string; // Communications → Text messages flash
    feed?: string; // Public Page & Brand → syndication contact flash
  };
}) {
  const org = await getCurrentOrg();
  if (!org) return null;

  // Properties power the "View public renter page" picker — a one-click way to
  // see exactly what renters get from the shared intake URL, for ANY listing
  // (F2 fix, S225: this used to surface only the newest property).
  const supabase = createClient();
  // Only listings that actually render a public /r page belong in the picker.
  // get_public_listing 404s 'draft' + 'off_market' (migration 0020), so a draft
  // (e.g. a freshly duplicated rental) would lead to a 404 - exclude both here.
  // 'paused'/'leased' still load a "no longer available" page, fine to preview.
  const { data: propertyRows } = await supabase
    .from("properties")
    .select("id, address")
    .not("status", "in", "(draft,off_market)")
    .order("created_at", { ascending: false });
  const renterPageProperties = (propertyRows ?? []) as {
    id: string;
    address: string;
  }[];

  // The signed-in operator's own email prefills the test-send recipient — the
  // common case is "send it to me so I can see what renters get".
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const operatorEmail = user?.email ?? "";

  // Rotessa rent-collection connection (RLS scopes the row to this org). The
  // stored key is never read here — we only surface status + environment.
  const { data: rotessaRows } = await supabase
    .from("rotessa_accounts")
    .select("environment, connection_status, last_verified_at, last_error, api_key_encrypted")
    .limit(1);
  const rotessaRow = rotessaRows?.[0] as
    | {
        environment: string;
        connection_status: string;
        last_verified_at: string | null;
        last_error: string | null;
        api_key_encrypted: string | null;
      }
    | undefined;
  const rotessaAccount: RotessaAccountView | null = rotessaRow
    ? {
        environment: rotessaRow.environment,
        connection_status: rotessaRow.connection_status,
        last_verified_at: rotessaRow.last_verified_at,
        last_error: rotessaRow.last_error,
        hasKey: !!rotessaRow.api_key_encrypted,
      }
    : null;
  const rotessaEncConfigured = encryptionConfigured();

  // Stripe Connect rent-collection connection (RLS scopes the row to this org).
  // We surface only the cached status snapshot — never a secret (there isn't one).
  const { data: stripeConnectRows } = await supabase
    .from("stripe_connect_accounts")
    .select(
      "connected_account_id, country, charges_enabled, payouts_enabled, details_submitted, acss_status, ach_status, onboarding_state, last_synced_at, last_error",
    )
    .limit(1);
  const stripeConnectRow = stripeConnectRows?.[0] as
    | {
        connected_account_id: string;
        country: string | null;
        charges_enabled: boolean;
        payouts_enabled: boolean;
        details_submitted: boolean;
        acss_status: string;
        ach_status: string;
        onboarding_state: string;
        last_synced_at: string | null;
        last_error: string | null;
      }
    | undefined;
  const stripeConnectAccount: StripeConnectAccountView | null = stripeConnectRow
    ? {
        connected: !!stripeConnectRow.connected_account_id,
        country: stripeConnectRow.country,
        charges_enabled: stripeConnectRow.charges_enabled,
        payouts_enabled: stripeConnectRow.payouts_enabled,
        details_submitted: stripeConnectRow.details_submitted,
        acss_status: stripeConnectRow.acss_status,
        ach_status: stripeConnectRow.ach_status,
        onboarding_state: stripeConnectRow.onboarding_state,
        last_synced_at: stripeConnectRow.last_synced_at,
        last_error: stripeConnectRow.last_error,
      }
    : null;
  const stripeConfigured = !!getStripe();

  // Saved tenant-message templates (org-level). RLS scopes to this org.
  const { data: templateRows } = await supabase
    .from("tenant_message_templates")
    .select("id, name, channel, subject, body")
    .order("name", { ascending: true });
  const templates = (templateRows ?? []) as {
    id: string;
    name: string;
    channel: string;
    subject: string | null;
    body: string;
  }[];
  const tplFlash =
    searchParams.tpl === "created"
      ? "Template created."
      : searchParams.tpl === "updated"
        ? "Template saved."
        : searchParams.tpl === "deleted"
          ? "Template deleted."
          : null;
  const tplError =
    searchParams.tpl && !["created", "updated", "deleted"].includes(searchParams.tpl)
      ? commsErrorMessage(searchParams.tpl)
      : null;

  // IA Step 3 (S275): the lease clause library moved to /dashboard/tenants/
  // lease-clauses. Its fetch + flash handling live on that page now.

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  // Absolute origin for the renter-page picker (empty -> relative path).
  const renterPageBaseUrl = host ? `${proto}://${host}` : "";

  // Listing syndication feed readiness (S242 feed completeness + operator
  // surface). Call the SAME anon get_org_listing_feed RPC the public /api/feed
  // route serves, so the readiness numbers match the live feed exactly
  // (available listings only; photos joined from property_photos).
  const { data: feedData } = await supabase.rpc("get_org_listing_feed", {
    p_org_slug: org.slug,
  });
  const feedListingsRaw =
    feedData && typeof feedData === "object" && "listings" in feedData
      ? (feedData as { listings?: unknown }).listings
      : [];
  const feedListings = (
    Array.isArray(feedListingsRaw) ? feedListingsRaw : []
  ) as FeedListingInput[];
  const feedSummary = summarizeFeed(
    {
      name: org.name,
      slug: org.slug,
      contact_phone: org.public_contact_phone,
      contact_email: org.public_contact_email,
    },
    feedListings,
  );
  const feedUrl = `${renterPageBaseUrl}/api/feed/${org.slug}`;
  const FEED_MISSING_LABEL: Record<FeedMissingField, string> = {
    price: "monthly rent",
    photo: "at least one photo",
    description: "a description",
    address: "the address",
  };

  const color = org.brand_color || DEFAULT_BRAND_COLOR;
  // The preview mirrors what renters actually see: the dashboard header and
  // public pages use an accessibility-guardrailed (darkened-as-needed) variant
  // so white text stays readable on a pale color.
  const displayColor = accessibleBrand(color);
  // Saved brand surface for the preview card: an ombre when a second stop is
  // set, otherwise the solid (both legibility-guarded).
  const displayBg = brandGradientCss(color, org.brand_color_secondary);
  const wasDarkened = isBrandColorTooLight(color);

  const tab = resolveTab(searchParams);

  // --- Flash flags ---
  const saved = searchParams.saved === "1"; // brand identity saved
  const error = searchParams.error; // brand identity validation/save error
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
  const senderFlash = searchParams.sender;
  const renterFlash = searchParams.renter;
  const smsFlash = searchParams.sms;

  return (
    <div>
      <PageHeader
        icon={<Icons.settings />}
        title="Settings"
        subtitle="Control how your brand appears to renters and how automated emails and texts behave."
      />

      <SettingsTabs active={tab} />

      {/* ================= Tab 1 — Public Page & Brand ================= */}
      {tab === "brand" && (
        <div className="mt-6 space-y-6">
          {saved && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Branding saved. Renter-facing pages and emails now use these details.
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error === "save"
                ? "Something went wrong saving your changes. Please try again."
                : "Some fields weren't valid. Check the brand color (a hex like #0e8c8c)."}
            </div>
          )}
          {logoSaved && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Logo updated. It now appears on your public pages and emails.
            </div>
          )}
          {logoRemoved && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              Logo removed. Your business name shows in its place.
            </div>
          )}
          {logoErrMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {logoErrMsg}
            </div>
          )}

          <form
            action={updateBrandIdentity}
            className="grid grid-cols-1 gap-6 lg:grid-cols-3"
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

              <div className="mt-5">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Brand color
                </span>
                <span className="mb-2 block text-xs text-gray-400">
                  Used for the header bar, listing accents, and the email accent
                  stripe. Pick a solid or a two-color ombre.
                </span>
                <BrandColorField
                  defaultPrimary={color}
                  defaultSecondary={org.brand_color_secondary}
                  logoUrl={org.logo_url}
                />
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
                  style={{ background: displayBg }}
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
                    style={{ background: displayBg }}
                  >
                    Book a viewing
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
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
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

          {/* Public renter page — see exactly what renters get from your link */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                  Public renter page
                </h3>
              </div>
              <RenterPagePreview
                properties={renterPageProperties}
                baseUrl={renterPageBaseUrl}
              />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              Open the live page renters see when you share a listing link — pick
              any listing to preview its branded inquiry and booking page.
            </p>
          </div>

          {/* --- Listing syndication feed (S242) --- */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2.5">
              <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Listing syndication feed
              </h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Your Live listings are published as a single feed a rental
              aggregator (like Zumper, PadMapper, or Rentsync) can pull from to
              syndicate them. Add a contact phone below, then send the feed link
              to the aggregator to get listed.
            </p>

            {searchParams.feed === "saved" && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                Contact details saved. Your feed now includes them.
              </div>
            )}
            {searchParams.feed === "phone" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                That phone number didn&apos;t look valid. Use a format like
                226-773-7555, or leave it blank.
              </div>
            )}
            {searchParams.feed === "email" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                The contact email must be a valid email address, or left blank.
              </div>
            )}
            {searchParams.feed === "error" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                Something went wrong saving your contact details. Please try again.
              </div>
            )}

            {/* Public contact details (the feed's account-level contact block) */}
            <form
              action={updatePublicContact}
              className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Contact phone
                </span>
                <input
                  name="public_contact_phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="226-773-7555"
                  defaultValue={org.public_contact_phone ?? ""}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <span className="mt-1 block text-xs text-gray-400">
                  Required by aggregators. Shown on syndicated listings so renters
                  can reach you.
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Contact email <span className="text-gray-400">(optional)</span>
                </span>
                <input
                  name="public_contact_email"
                  type="email"
                  inputMode="email"
                  placeholder="leasing@yourcompany.com"
                  defaultValue={org.public_contact_email ?? ""}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <span className="mt-1 block text-xs text-gray-400">
                  Leave blank to use your reply-to email.
                </span>
              </label>
              <div className="sm:col-span-2">
                <button className="rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
                  Save contact details
                </button>
              </div>
            </form>

            {/* Copyable feed URL */}
            <div className="mt-6 border-t border-gray-100 pt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Your feed link
              </h4>
              <p className="mt-1 text-sm text-gray-500">
                Send this URL to an aggregator to syndicate your Live listings. It
                updates automatically as your listings change.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="flex-1 min-w-[16rem] overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  {feedUrl}
                </code>
                <CopyLinkButton
                  path={`/api/feed/${org.slug}`}
                  label="Copy feed URL"
                />
                <a
                  href={`/api/feed/${org.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Open feed ↗
                </a>
              </div>
            </div>

            {/* Feed readiness — what syndicates vs what's skipped and why */}
            <div className="mt-6 border-t border-gray-100 pt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Feed readiness
              </h4>

              {feedSummary.orgPhoneMissing && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  Add a contact phone above — aggregators require one before they
                  accept your feed.
                </div>
              )}

              {feedSummary.total === 0 ? (
                <p className="mt-3 text-sm text-gray-500">
                  No Live listings yet. Set a listing to Live and it will appear
                  here once it has a rent, a photo, a description, and an address.
                </p>
              ) : (
                <>
                  <p className="mt-3 text-sm text-gray-700">
                    <span className="font-semibold text-gray-900">
                      {feedSummary.readyCount} of {feedSummary.total}
                    </span>{" "}
                    Live {feedSummary.total === 1 ? "listing is" : "listings are"}{" "}
                    ready to syndicate.
                  </p>
                  {feedSummary.skippedCount > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-gray-500">
                        Skipped until complete:
                      </p>
                      <ul className="mt-2 space-y-2">
                        {feedSummary.skipped.map((s) => (
                          <li
                            key={s.id}
                            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                          >
                            <span className="font-medium text-gray-800">
                              {s.address?.trim() || "Untitled listing"}
                            </span>
                            <span className="block text-xs text-gray-500">
                              Needs:{" "}
                              {s.missing
                                .map((m) => FEED_MISSING_LABEL[m])
                                .join(", ")}
                              .
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              <p className="mt-3 text-xs text-gray-400">
                Only Live listings syndicate. Drafts, paused, and leased listings
                are never included.
              </p>
            </div>
          </div>

          {/* IA Step 3 (S275): Renter pre-screening + Building standard policy
              MOVED OUT of this tab to their point-of-use (the brand tab was
              doing 7 jobs — G6). They live where the operator actually uses
              them; these are the bridges (G7 fix). The editors are unchanged. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Link href="/dashboard/leasing/screening" className="block">
              <div className="flex h-full items-start gap-3.5 rounded-2xl border border-gray-200 bg-gray-50 p-5 transition hover:border-gray-300 hover:bg-gray-100">
                <IconTile size="sm"><Icons.users className="h-4 w-4" /></IconTile>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Renter pre-screening{" "}
                    <span className="font-normal text-brand">→ Leasing</span>
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Qualifying questions and auto-flagging now live in Leasing,
                    where you work your inquiries. Open to manage.
                  </p>
                </div>
              </div>
            </Link>
            <Link href="/dashboard/properties/standard-policy" className="block">
              <div className="flex h-full items-start gap-3.5 rounded-2xl border border-gray-200 bg-gray-50 p-5 transition hover:border-gray-300 hover:bg-gray-100">
                <IconTile size="sm"><Icons.building className="h-4 w-4" /></IconTile>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Building standard policy{" "}
                    <span className="font-normal text-brand">→ Rentals</span>
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Your building defaults (lease term, A/C, smoking, on-site
                    management) now live with your Rentals. Open to manage.
                  </p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* ================= Tab 2 — Communications ================= */}
      {tab === "comms" && (
        <div className="mt-6 space-y-6">
          {/* --- Email sender --- */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2.5">
              <IconTile size="sm"><Icons.mail className="h-4 w-4" /></IconTile>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Email sender
              </h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Emails always send from Vacantless&apos;s secure address, shown
              under your business name with your reply-to, so they pass spam
              checks and replies reach you. Renters never see a personal email
              address.
            </p>

            {senderFlash === "saved" && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                Reply-to saved. Renter replies will now be delivered there.
              </div>
            )}
            {senderFlash === "invalid" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                Reply-to must be a valid email address, or left blank.
              </div>
            )}
            {senderFlash === "error" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                Something went wrong saving the reply-to. Please try again.
              </div>
            )}

            <form action={updateEmailSender} className="mt-4">
              <label className="block max-w-md">
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
                  Where renter replies to your automated emails are delivered.
                  Leave blank to use the shared Vacantless inbox.
                </span>
              </label>
              <button className="mt-3 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
                Save reply-to
              </button>
            </form>

            {/* Send a test email */}
            <div className="mt-6 border-t border-gray-100 pt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Send a test email
              </h4>
              <p className="mt-1 text-sm text-gray-500">
                Email yourself a copy of the renter auto-reply with your current
                branding (name, color, logo, and reply-to) so you can see exactly
                what renters receive before you share your listing link.
              </p>

              {test === "sent" && (
                <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                  Test email sent{testedTo ? ` to ${testedTo}` : ""}. Check your
                  inbox (and spam folder) to see exactly what renters receive.
                </div>
              )}
              {test === "invalid" && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                  Please enter a valid email address to send the test to.
                </div>
              )}
              {test === "nokey" && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
                  Email sending isn&apos;t connected yet, so the test couldn&apos;t
                  go out. Your branded emails will start sending automatically once
                  email is enabled on your account.
                </div>
              )}
              {test === "failed" && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                  Something went wrong sending the test email. Please try again in
                  a moment.
                </div>
              )}

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
          </div>

          {/* --- Renter messages --- */}
          <form
            action={updateRenterMessages}
            className="rounded-2xl border border-gray-200 bg-white p-5"
          >
            <div className="flex items-center gap-2.5">
              <IconTile size="sm"><Icons.chat className="h-4 w-4" /></IconTile>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Renter messages
              </h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Automated, branded emails that go to renters as they move through
              inquiry, viewing, and follow-up.
            </p>

            {renterFlash === "saved" && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                Renter message settings saved.
              </div>
            )}
            {renterFlash === "invalid" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                The send delay must be a whole number of hours (0–336).
              </div>
            )}
            {renterFlash === "error" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                Something went wrong saving these settings. Please try again.
              </div>
            )}

            <div className="mt-5">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Post-viewing feedback
              </h4>
              <label className="flex items-start gap-3">
                <input
                  name="feedback_enabled"
                  type="checkbox"
                  defaultChecked={org.feedback_enabled}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">
                  <span className="block font-medium text-gray-700">
                    Email a feedback request after each attended viewing
                  </span>
                  <span className="block text-xs text-gray-400">
                    Renters get a one-tap 1–5 star rating link once you mark their
                    viewing as Attended. Results show on the viewing and in Reports.
                  </span>
                </span>
              </label>

              <label className="mt-4 block">
                <span className="mb-1 block text-sm font-medium text-gray-700">
                  Send delay (hours after the viewing)
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
                  How long to wait after the viewing time before sending. Default
                  is 2 hours.
                </span>
              </label>
            </div>

            <div className="mt-6 border-t border-gray-100 pt-5">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Automatic follow-up
              </h4>
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
                    viewing. It stops automatically the moment a renter books, is
                    marked lost, or moves further along.
                  </span>
                </span>
              </label>
            </div>

            <button className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
              Save renter messages
            </button>
          </form>

          {/* --- Tenant messages (templates) --- */}
          <div id="templates" className="scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2.5">
              <IconTile size="sm"><Icons.mail className="h-4 w-4" /></IconTile>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Tenant messages
              </h3>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              Reusable message templates you can send to tenants from a tenancy
              (rent reminders, maintenance notices, and more). Use tokens like{" "}
              <code className="rounded bg-gray-100 px-1 text-xs">{"{{first_name}}"}</code>,{" "}
              <code className="rounded bg-gray-100 px-1 text-xs">{"{{property_address}}"}</code>,{" "}
              <code className="rounded bg-gray-100 px-1 text-xs">{"{{rent}}"}</code> — they fill
              in per tenant when you send.
            </p>
            <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Saved here, used over in{" "}
              <Link href="/dashboard/tenancies" className="font-semibold underline">
                Tenancies
              </Link>
              : open a tenancy, start a message, and pick a template to fill it in. ↗
            </p>

            {tplFlash && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                {tplFlash}
              </div>
            )}
            {tplError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                {tplError}
              </div>
            )}

            {/* Existing templates */}
            {templates.length > 0 && (
              <ul className="mt-4 space-y-3">
                {templates.map((tpl) => (
                  <li key={tpl.id} className="rounded-xl border border-gray-200 p-4">
                    <form action={saveMessageTemplate} className="space-y-3">
                      <input type="hidden" name="id" value={tpl.id} />
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="min-w-[12rem] flex-1">
                          <span className="mb-1 block text-xs font-medium text-gray-600">Name</span>
                          <input name="name" defaultValue={tpl.name} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        </label>
                        <label className="w-44">
                          <span className="mb-1 block text-xs font-medium text-gray-600">Channel</span>
                          <select name="channel" defaultValue={tpl.channel} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                            {MESSAGE_CHANNELS.map((c) => (
                              <option key={c} value={c}>{channelLabel(c)}</option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600">
                          Subject <span className="text-gray-400">(used for email)</span>
                        </span>
                        <input name="subject" defaultValue={tpl.subject ?? ""} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-600">Message</span>
                        <textarea name="body" rows={3} defaultValue={tpl.body} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                      </label>
                      <div className="flex items-center gap-2">
                        <button className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                          Save
                        </button>
                      </div>
                    </form>
                    <form action={deleteMessageTemplate} className="mt-2">
                      <input type="hidden" name="id" value={tpl.id} />
                      <button className="text-xs font-medium text-red-600 hover:text-red-700">
                        Delete template
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}

            {/* Create new template */}
            <form
              // Keyed on the post-submit nonce so a successful create REMOUNTS this
              // form and clears its uncontrolled inputs (S226 QA-audit form-reset).
              key={`new-tpl-${searchParams.tn ?? "new"}`}
              action={saveMessageTemplate}
              className="mt-5 space-y-3 border-t border-gray-100 pt-5"
            >
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                New template
              </h4>
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[12rem] flex-1">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Name</span>
                  <input name="name" placeholder="e.g. Rent due reminder" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </label>
                <label className="w-44">
                  <span className="mb-1 block text-xs font-medium text-gray-600">Channel</span>
                  <select name="channel" defaultValue="email" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {MESSAGE_CHANNELS.map((c) => (
                      <option key={c} value={c}>{channelLabel(c)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  Subject <span className="text-gray-400">(used for email)</span>
                </span>
                <input name="subject" placeholder="Rent reminder for {{property_address}}" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Message</span>
                <textarea name="body" rows={3} placeholder={"Hi {{first_name}}, a reminder that rent of {{rent}} is due..."} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm">
                Add template
              </button>
            </form>
          </div>

          {/* --- Text messages --- */}
          <form
            action={updateTextMessages}
            className="rounded-2xl border border-gray-200 bg-white p-5"
          >
            <div className="flex items-center gap-2.5">
              <IconTile size="sm"><Icons.chat className="h-4 w-4" /></IconTile>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Text messages
              </h3>
            </div>

            {smsFlash === "saved" && (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
                Text message setting saved.
              </div>
            )}
            {smsFlash === "error" && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
                Something went wrong saving this setting. Please try again.
              </div>
            )}

            <label className="mt-4 flex items-start gap-3">
              <input
                name="sms_enabled"
                type="checkbox"
                defaultChecked={org.sms_enabled}
                className="mt-0.5 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">
                <span className="block font-medium text-gray-700">
                  Also text renters their booking confirmation and viewing
                  reminders
                </span>
                <span className="block text-xs text-gray-400">
                  When a renter leaves a phone number, we send a short text
                  confirming their booking and reminders about 24 hours and 2
                  hours before the viewing, alongside the emails. Every text
                  includes &quot;Reply STOP to opt out,&quot; and a renter who
                  replies STOP is never texted again. Texting starts once your
                  account&apos;s SMS is connected.
                </span>
              </span>
            </label>

            <button className="mt-5 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white shadow-sm">
              Save text messages
            </button>
          </form>
        </div>
      )}

      {/* IA Step 3 (S275): the Lease Clauses tab MOVED OUT of Settings to its
          point-of-use under Tenants → Lease clauses (set where you use them,
          G7). The clause CRUD + data fetch live on that page now. */}

      {/* ================= Tab — Banking & Rent ================= */}
      {tab === "banking" && (
        <div className="mt-6 space-y-6">
          {searchParams.rotessa === "connected" && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Rotessa connected. We verified your API key and can now schedule rent
              collection.
            </div>
          )}
          {searchParams.rotessa === "tested" && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Rotessa connection verified.
            </div>
          )}
          {searchParams.rotessa === "disconnected" && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              Rotessa disconnected. Your stored key was removed. Schedules already in
              Rotessa are unaffected.
            </div>
          )}
          {(searchParams.rotessa === "connfail" ||
            searchParams.rotessa === "testfail") && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              We couldn&apos;t verify the Rotessa connection. See the details below
              and check your API key and environment.
            </div>
          )}
          {searchParams.rotessa === "invalid" && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              That API key didn&apos;t look valid. Paste the key from your Rotessa
              admin portal.
            </div>
          )}
          {searchParams.rotessa === "nokey" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Secure key storage isn&apos;t configured on this deployment yet
              (ROTESSA_ENC_KEY). The key wasn&apos;t saved.
            </div>
          )}
          {searchParams.rotessa === "decfail" && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              We couldn&apos;t read the stored Rotessa key. Reconnect with your API
              key to fix this.
            </div>
          )}
          {(searchParams.rotessa === "saveerror" ||
            searchParams.rotessa === "norow") && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Something went wrong with the Rotessa connection. Please try again.
            </div>
          )}
          {searchParams.rotessa === "notconnected" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Connect your Rotessa account below before exporting rent payments.
            </div>
          )}
          {searchParams.rotessa === "exportfail" && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              We couldn&apos;t pull your Rotessa payment history just now. Check the
              connection below and try again.
            </div>
          )}

          {(searchParams.stripeconnect === "returned" ||
            searchParams.stripeconnect === "synced") && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Stripe rent collection updated. Use <strong>Refresh status</strong> below to
              pull the latest from Stripe.
            </div>
          )}
          {searchParams.stripeconnect === "disconnected" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Stripe rent collection disconnected. Your Stripe account and any tenant
              authorizations are unaffected.
            </div>
          )}
          {searchParams.stripeconnect === "notconfigured" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Payments aren&apos;t configured on this deployment yet (STRIPE_SECRET_KEY).
            </div>
          )}
          {(searchParams.stripeconnect === "createfail" ||
            searchParams.stripeconnect === "linkfail" ||
            searchParams.stripeconnect === "syncfail" ||
            searchParams.stripeconnect === "norow") && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Something went wrong setting up Stripe rent collection. Please try again.
              {typeof searchParams.reason === "string" && searchParams.reason && (
                <div className="mt-1 font-mono text-xs text-red-700">
                  {searchParams.reason}
                </div>
              )}
            </div>
          )}

          <RotessaSettingsCard
            account={rotessaAccount}
            encConfigured={rotessaEncConfigured}
          />
          <StripeConnectSettingsCard
            account={stripeConnectAccount}
            stripeConfigured={stripeConfigured}
          />
        </div>
      )}

      {/* ================= Tab 4 — Account & Plan ================= */}
      {tab === "account" && (
        <div className="mt-6 space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2.5">
              <IconTile size="sm"><Icons.key className="h-4 w-4" /></IconTile>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Account
              </h3>
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
                : "Renter replies to automated emails route to the shared Vacantless inbox."}{" "}
              Change this under{" "}
              <Link href="/dashboard/settings?tab=comms" className="font-medium underline">
                Communications → Email sender
              </Link>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
