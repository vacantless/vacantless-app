import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { ReportForm } from "./report-form";

export const dynamic = "force-dynamic";

// Public tenant incident-reporting surface (Option B incident-dispatch, Slice 2).
// The per-tenancy report token is the tenant's only handle: no account, the same
// magic-link pattern as /sign. Brand-themed like the public /f, /r, and /sign
// pages. The report (category + description + optional photos/video) lands in
// incident_reports via a SECURITY DEFINER RPC that re-derives the tenancy from
// the token; nothing the client sends but the token + payload is trusted.

type Context = {
  token: string;
  accepting: boolean;
  tenancy_status: string;
  property_address: string | null;
  reporter_name: string | null;
  reporter_contact: string | null;
  org_name: string;
  brand_color: string | null;
  brand_color_secondary: string | null;
  logo_url: string | null;
};

export default async function ReportIncidentPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { submitted?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_incident_report_context", {
    p_token: params.token,
  });
  if (!data) notFound();
  const c = data as Context;

  const brand = accessibleBrand(c.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(c.brand_color, c.brand_color_secondary);
  const submitted = searchParams.submitted === "1";

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{
        ["--brand-color" as string]: brand,
        ["--brand-gradient" as string]: brandBg,
      }}
    >
      <header className="relative text-white shadow-md" style={{ background: brandBg }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="mx-auto max-w-2xl px-6 py-5">
          {c.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.logo_url} alt={c.org_name} className="h-8" />
          ) : (
            <p className="text-lg font-bold">{c.org_name}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {submitted ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">Thanks — we&apos;ve got your report.</h1>
            <p className="mt-2 text-sm text-gray-600">
              {c.org_name} has received the details and will be in touch.
              {c.property_address ? (
                <>
                  {" "}
                  You can use this same link any time to report another issue at{" "}
                  <span className="font-medium text-gray-800">{c.property_address}</span>.
                </>
              ) : (
                " You can use this same link any time to report another issue."
              )}
            </p>
            <a
              href={`/report/${encodeURIComponent(c.token)}`}
              className="mt-5 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white"
              style={{ background: brandBg }}
            >
              Report another issue
            </a>
          </div>
        ) : !c.accepting ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">This reporting link isn&apos;t active.</h1>
            <p className="mt-2 text-sm text-gray-600">
              If you&apos;re a current tenant and were expecting to report an issue, please
              contact {c.org_name} directly.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Report a maintenance issue</h1>
              <p className="mt-1 text-sm text-gray-600">
                Tell {c.org_name} what&apos;s wrong
                {c.property_address ? (
                  <>
                    {" "}
                    at <span className="font-medium text-gray-800">{c.property_address}</span>
                  </>
                ) : null}
                . Add a photo or short video if it helps explain.
              </p>
            </div>
            <ReportForm
              token={c.token}
              brandBg={brandBg}
              defaultName={c.reporter_name}
              defaultContact={c.reporter_contact}
            />
          </>
        )}
      </main>
    </div>
  );
}
