import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  accessibleBrand,
  brandGradientCss,
  DEFAULT_BRAND_COLOR,
} from "@/lib/brand-theme";
import { confirmShowingFromLeadToken } from "./actions";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
  confirmed_at: string | null;
  property_id: string | null;
  organization: {
    name: string | null;
    brand_color: string | null;
    brand_color_secondary: string | null;
    logo_url: string | null;
    booking_timezone: string | null;
  } | null;
  lead: { name: string | null } | null;
  property: { address: string | null } | null;
};

function fmtWhen(iso: string | null, tz: string): string {
  if (!iso) return "the scheduled time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export default async function ConfirmShowingPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();

  const { data } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, outcome, confirmed_at, property_id, " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url, booking_timezone), " +
        "lead:leads(name), property:properties(address)",
    )
    .eq("cancel_token", params.token)
    .maybeSingle();
  if (!data) notFound();
  const row = data as unknown as Row;

  const orgName = row.organization?.name || "Your leasing team";
  const brand = accessibleBrand(row.organization?.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(
    row.organization?.brand_color,
    row.organization?.brand_color_secondary,
  );
  const tz = row.organization?.booking_timezone || "America/Toronto";

  const firstName = (row.lead?.name?.trim() || "").split(/\s+/)[0] || "there";
  const address = row.property?.address?.trim() || "the property";
  const when = fmtWhen(row.scheduled_at, tz);
  const isScheduled = row.outcome === "scheduled";
  const isConfirmed =
    isScheduled && (searchParams.status === "confirmed" || row.confirmed_at != null);
  const canConfirm = isScheduled && !isConfirmed;
  const rescheduleUrl = `/showing/reschedule/${encodeURIComponent(params.token)}`;

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ ["--brand-color" as string]: brand, ["--brand-gradient" as string]: brandBg }}
    >
      <header className="relative text-white shadow-md" style={{ background: brandBg }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="mx-auto max-w-2xl px-6 py-5">
          {row.organization?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.organization.logo_url} alt={orgName} className="h-8" />
          ) : (
            <p className="text-lg font-semibold">{orgName}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          {isConfirmed ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">You&apos;re confirmed</h1>
              <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                You&apos;re confirmed — see you then!
              </p>
              <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{address}</p>
                <p className="mt-1 text-gray-600">{when}</p>
              </div>
            </>
          ) : canConfirm ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Confirm your viewing</h1>
              <p className="mt-2 text-sm text-gray-600">
                Hi {firstName}, please confirm you&apos;re still coming to:
              </p>
              <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{address}</p>
                <p className="mt-1 text-gray-600">{when}</p>
              </div>

              {searchParams.status === "error" && (
                <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  Something went wrong confirming that. Please try again, or reply
                  to your reminder email.
                </p>
              )}

              <div className="mt-6 space-y-3">
                <form action={confirmShowingFromLeadToken}>
                  <input type="hidden" name="token" value={params.token} />
                  <button
                    type="submit"
                    className="w-full rounded-xl px-4 py-3.5 text-center text-base font-semibold text-white shadow-sm"
                    style={{ background: brandBg }}
                  >
                    Yes, I&apos;ll be there
                  </button>
                </form>
                <a
                  href={rescheduleUrl}
                  className="block rounded-xl border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Can&apos;t make it? Reschedule
                </a>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">
                This viewing is no longer active
              </h1>
              <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                This viewing at <span className="font-medium">{address}</span> ({when}) can no
                longer be confirmed here. If you think that&apos;s a mistake, just
                reply to your reminder email.
              </p>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
