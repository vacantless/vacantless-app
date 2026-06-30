import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, brandGradientCss } from "@/lib/brand-theme";
import {
  normalizeWindows,
  sortWindows,
  windowKey,
  formatIsoDateShort,
  formatWindowClock,
  isTenantScheduleLinkExpired,
  type DayWindow,
} from "@/lib/repair-scheduling";
import { submitTenantAvailability } from "./actions";

export const dynamic = "force-dynamic";

// Public tenant pick-your-times page (repair-scheduling Slice 3). No account —
// the token in the URL is the tenant's only handle, the same magic-link pattern
// as the trade /job/[token] and tenant /report/[token] surfaces. The tenant
// ticks the arrival windows their property manager's supplier offered (and/or
// adds a free time), and that becomes the availability the operator reconciles.
// Read by the service-role admin client, scoped strictly to the row whose token
// matches; a wrong/expired token reveals nothing.

type Row = {
  supplier_windows: unknown;
  tenant_availability: unknown;
  chosen_date: string | null;
  chosen_start_minute: number | null;
  chosen_end_minute: number | null;
  status: string;
  token_expires_at: string | null;
  organization: {
    name: string | null;
    brand_color: string | null;
    brand_color_secondary: string | null;
    logo_url: string | null;
  } | null;
  work_order: { title: string | null; property: { address: string } | null } | null;
};

function fmtFullDate(date: string): string {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  if (!y || !m || !d) return date;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function TenantSchedulePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();

  const { data } = await admin
    .from("work_order_appointments")
    .select(
      "supplier_windows, tenant_availability, chosen_date, chosen_start_minute, chosen_end_minute, status, token_expires_at, " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url), " +
        "work_order:work_orders(title, property:properties(address))",
    )
    .eq("tenant_access_token", params.token)
    .maybeSingle();
  if (!data) notFound();
  const row = data as unknown as Row;

  const orgName = row.organization?.name || "Your property manager";
  const brand = accessibleBrand(row.organization?.brand_color || "#4f46e5");
  const brandBg = brandGradientCss(row.organization?.brand_color, row.organization?.brand_color_secondary);
  const address = row.work_order?.property?.address ?? null;
  const jobTitle = row.work_order?.title ?? "a repair visit";

  const supplier = sortWindows(
    normalizeWindows(Array.isArray(row.supplier_windows) ? (row.supplier_windows as DayWindow[]) : []),
  );
  const tenant = normalizeWindows(
    Array.isArray(row.tenant_availability) ? (row.tenant_availability as DayWindow[]) : [],
  );
  const tenantKeys = new Set(tenant.map(windowKey));

  const confirmed =
    row.status === "confirmed" &&
    !!row.chosen_date &&
    row.chosen_start_minute != null &&
    row.chosen_end_minute != null;
  const expired = isTenantScheduleLinkExpired(row.token_expires_at);
  const status = searchParams.status;

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
          {confirmed ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Your visit is booked</h1>
              <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                <span className="font-medium">{fmtFullDate(row.chosen_date as string)}</span>
                <br />
                {formatWindowClock(row.chosen_start_minute as number, row.chosen_end_minute as number)}
              </p>
              <p className="mt-4 text-sm text-gray-600">
                {orgName} has scheduled {jobTitle}
                {address ? ` at ${address}` : ""}. You can close this page.
              </p>
            </>
          ) : expired ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">This link has expired</h1>
              <p className="mt-3 text-sm text-gray-600">
                Please ask {orgName} to send you a fresh scheduling link.
              </p>
            </>
          ) : status === "submitted" ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Thanks — we&rsquo;ve got your times</h1>
              <p className="mt-3 text-sm text-gray-600">
                {orgName} will confirm a visit time that fits both you and the technician, and you&rsquo;ll
                hear back with the booked slot. You can update your availability any time from this page.
              </p>
              <a href={`/repair/${encodeURIComponent(params.token)}`} className="mt-4 inline-block text-sm font-medium" style={{ color: brand }}>
                Update my availability
              </a>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">When can you be home?</h1>
              <p className="mt-2 text-sm text-gray-600">
                {orgName} is arranging {jobTitle}
                {address ? ` at ${address}` : ""}. Let us know when you can be home so we can match it with
                the technician&rsquo;s available windows.
              </p>

              {status === "empty" && (
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  Please tick at least one window or add a time you&rsquo;re free.
                </p>
              )}
              {status === "badtime" && (
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  Please enter a valid date with a start time before the end time.
                </p>
              )}
              {status === "error" && (
                <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  Something went wrong saving your times. Please try again.
                </p>
              )}

              <form action={submitTenantAvailability} className="mt-6 space-y-6">
                <input type="hidden" name="token" value={params.token} />

                {supplier.length > 0 ? (
                  <fieldset>
                    <legend className="text-sm font-medium text-gray-800">
                      Which of these arrival windows can you be home for?
                    </legend>
                    <p className="mt-1 text-xs text-gray-500">
                      The technician arrives sometime within the window, so please pick ones you can be home for the whole time.
                    </p>
                    <ul className="mt-3 space-y-2">
                      {supplier.map((w) => {
                        const key = windowKey(w);
                        return (
                          <li key={key}>
                            <label className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 text-sm hover:bg-gray-50">
                              <input
                                type="checkbox"
                                name="win"
                                value={key}
                                defaultChecked={tenantKeys.has(key)}
                                className="h-4 w-4"
                              />
                              <span>
                                <span className="font-medium">{formatIsoDateShort(w.date)}</span>{" "}
                                {formatWindowClock(w.start_minute, w.end_minute)}
                                {w.label ? <span className="text-gray-500"> · {w.label}</span> : null}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                ) : (
                  <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                    {orgName} hasn&rsquo;t added time options yet — tell us when you&rsquo;re generally free below
                    and they&rsquo;ll line it up with the technician.
                  </p>
                )}

                <fieldset>
                  <legend className="text-sm font-medium text-gray-800">
                    {supplier.length > 0 ? "Or add another time you’re free (optional)" : "A time you’re free"}
                  </legend>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600">Date</label>
                      <input type="date" name="custom_date" className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">From</label>
                      <input type="time" name="custom_start" className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">To</label>
                      <input type="time" name="custom_end" className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                  </div>
                </fieldset>

                <button
                  type="submit"
                  className="w-full rounded-md px-4 py-2.5 text-sm font-medium text-white sm:w-auto"
                  style={{ background: brandBg }}
                >
                  Send my availability
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
