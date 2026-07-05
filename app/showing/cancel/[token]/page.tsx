import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, brandGradientCss } from "@/lib/brand-theme";
import { cancelShowingFromToken } from "./actions";

export const dynamic = "force-dynamic";

// Public one-tap viewing-cancellation page (S418, KI632). The renter arrives from
// the "Cancel this viewing" link in their booking confirmation email with NO
// session - the cancel_token in the URL is their only handle, the same magic-link
// pattern as /showing/[token] (outcome) and /repair/[token]. Read by the
// service-role admin client, scoped strictly to the row whose cancel_token
// matches; a wrong token reveals nothing. The page only RENDERS (GET); the Cancel
// button POSTs the server action, so email link scanners that prefetch the GET
// URL can never cancel a viewing (KI585).

type Row = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
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

export default async function CancelShowingPage({
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
      "id, scheduled_at, outcome, property_id, " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url, booking_timezone), " +
        "lead:leads(name), property:properties(address)",
    )
    .eq("cancel_token", params.token)
    .maybeSingle();
  if (!data) notFound();
  const row = data as unknown as Row;

  const orgName = row.organization?.name || "Your leasing team";
  const brand = accessibleBrand(row.organization?.brand_color || "#4f46e5");
  const brandBg = brandGradientCss(
    row.organization?.brand_color,
    row.organization?.brand_color_secondary,
  );
  const tz = row.organization?.booking_timezone || "America/Toronto";

  const firstName = (row.lead?.name?.trim() || "").split(/\s+/)[0] || "there";
  const address = row.property?.address?.trim() || "the property";
  const when = fmtWhen(row.scheduled_at, tz);
  const rebookUrl = row.property_id ? `/r/${row.property_id}` : null;

  const status = searchParams.status;
  // The viewing is off - either just cancelled via the button, or it was already
  // cancelled before this visit. Either way, show the done state (with rebook).
  const isCancelled = status === "cancelled" || row.outcome === "cancelled";

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
          {isCancelled ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Your viewing is cancelled</h1>
              <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                We&apos;ve cancelled your viewing at <span className="font-medium">{address}</span>{" "}
                ({when}). Thanks for letting us know.
              </p>
              {rebookUrl && (
                <div className="mt-6">
                  <p className="text-sm text-gray-600">Changed your mind or want a different time?</p>
                  <a
                    href={rebookUrl}
                    className="mt-3 inline-flex items-center justify-center rounded-xl px-4 py-3 text-base font-semibold text-white shadow-sm"
                    style={{ background: brandBg }}
                  >
                    Book a new viewing
                  </a>
                </div>
              )}
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Cancel this viewing?</h1>
              <p className="mt-2 text-sm text-gray-600">
                Hi {firstName}, you booked a viewing for:
              </p>
              <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                <p className="font-medium text-gray-900">{address}</p>
                <p className="mt-1 text-gray-600">{when}</p>
              </div>

              {status === "error" && (
                <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  Something went wrong cancelling that. Please try again, or reply to your
                  confirmation email.
                </p>
              )}

              <div className="mt-6 space-y-3">
                <form action={cancelShowingFromToken}>
                  <input type="hidden" name="token" value={params.token} />
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-red-600 px-4 py-3.5 text-center text-base font-semibold text-white hover:bg-red-700"
                  >
                    Yes, cancel my viewing
                  </button>
                </form>
                {rebookUrl && (
                  <a
                    href={rebookUrl}
                    className="block rounded-xl border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Keep it - I&apos;ll be there
                  </a>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
