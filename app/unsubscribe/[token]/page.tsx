import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { verifyRenterUnsubscribeToken } from "@/lib/renter-unsubscribe";
import { renterUnsubscribeSecret } from "@/lib/renter-unsubscribe-server";
import { unsubscribeRenter } from "./actions";

export const dynamic = "force-dynamic";

// S728: public, unauthenticated renter unsubscribe page. The link in the
// email only renders this page; the button POSTs the server action, so an
// email scanner that prefetches the link never unsubscribes anyone (the same
// rule as /showing/cancel, KI585).

type Row = {
  id: string;
  email: string | null;
  email_opt_out_at: string | null;
  organization: {
    name: string | null;
    brand_color: string | null;
    brand_color_secondary: string | null;
    logo_url: string | null;
  } | null;
};

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const v = verifyRenterUnsubscribeToken(params.token, renterUnsubscribeSecret());
  const admin = v ? createAdminClient() : null;
  let row: Row | null = null;
  if (admin && v) {
    if (v.subject === "waitlist") {
      const { data } = await admin
        .from("waitlist_entries")
        .select("id, email, status, organization:organizations(name, brand_color, brand_color_secondary, logo_url)")
        .eq("id", v.id)
        .maybeSingle();
      const w = data as unknown as (Omit<Row, "email_opt_out_at"> & { status: string }) | null;
      row = w ? { id: w.id, email: w.email, email_opt_out_at: w.status === "removed" ? "removed" : null, organization: w.organization } : null;
    } else {
      const { data } = await admin
        .from("leads")
        .select("id, email, email_opt_out_at, organization:organizations(name, brand_color, brand_color_secondary, logo_url)")
        .eq("id", v.id)
        .maybeSingle();
      row = (data as unknown as Row | null) ?? null;
    }
  }

  const orgName = row?.organization?.name || "Vacantless";
  const brand = accessibleBrand(row?.organization?.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(row?.organization?.brand_color, row?.organization?.brand_color_secondary);
  const done = searchParams.status === "done" || !!row?.email_opt_out_at;
  const invalid = !row || searchParams.status === "invalid";

  return (
    <div className="min-h-screen bg-gray-50" style={{ ["--brand-color" as string]: brand }}>
      <header className="text-white shadow-md" style={{ background: brandBg }}>
        <div className="mx-auto max-w-2xl px-6 py-5">
          {row?.organization?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.organization.logo_url} alt={orgName} className="h-8" />
          ) : (
            <p className="text-lg font-semibold">{orgName}</p>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          {invalid ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">This link has expired</h1>
              <p className="mt-3 text-sm text-gray-600">
                Open the newest email from {orgName} and use the unsubscribe link at the bottom.
              </p>
            </>
          ) : done ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">You are unsubscribed</h1>
              <p className="mt-3 text-sm text-gray-600">
                {orgName} will not send follow-ups, new viewing times, waiting-list notices or price
                drops to {row?.email ?? "this address"} again. If you book a viewing, you will still get
                that booking&apos;s confirmation and reminders.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Unsubscribe from follow-up emails?</h1>
              <p className="mt-3 text-sm text-gray-600">
                {orgName} will stop sending follow-ups, new viewing times, waiting-list notices and price
                drops to {row?.email ?? "this address"}. Booking confirmations and viewing reminders for
                a viewing you book still arrive.
              </p>
              <form action={unsubscribeRenter} className="mt-6">
                <input type="hidden" name="token" value={params.token} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-base font-semibold text-white shadow-sm"
                  style={{ background: brandBg }}
                >
                  Unsubscribe
                </button>
              </form>
            </>
          )}
          <p className="mt-6 text-xs text-gray-400">Powered by Vacantless</p>
        </div>
      </main>
    </div>
  );
}
