import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { renderLeaseDocumentHtml, type LeaseRenderModel } from "@/lib/lease-render";
import { SignatureForm } from "./signature-form";

export const dynamic = "force-dynamic";

// Public tenant signing surface (lease vault #11, slice 4 — the homegrown
// ECA-2000 rail). The magic-link token is the tenant's only handle: no account,
// the Tenon10/SkySlope pattern. The lease they sign is the FROZEN snapshot
// captured at send (lease_documents.rendered_snapshot), so what is shown == what
// was hashed. Brand-themed like the public /f and /r pages.

type Context = {
  token: string;
  signer_role: string;
  signer_name: string | null;
  signer_status: string;
  already_signed: boolean;
  lease_status: string;
  signable: boolean;
  lease_title: string;
  rendered_snapshot: LeaseRenderModel | null;
  org_name: string;
  brand_color: string | null;
  brand_color_secondary: string | null;
  logo_url: string | null;
};

const ERROR_COPY: Record<string, string> = {
  consent_required: "Please confirm you agree to sign electronically.",
  name_required: "Please enter your full legal name.",
  bad_kind: "Please choose how to sign (type or draw).",
  signature_required: "Please add your signature before submitting.",
  already_signed: "You've already signed this lease.",
  not_signable: "This lease is no longer available for signature.",
  not_found: "We couldn't find this signing link.",
  failed: "Something went wrong. Please try again.",
};

function firstName(name: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0] || "there";
}

export default async function SignLeasePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { signed?: string; error?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_lease_signing_context", {
    p_token: params.token,
  });
  if (!data) notFound();
  const c = data as Context;

  const brand = accessibleBrand(c.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(c.brand_color, c.brand_color_secondary);
  const justSigned = searchParams.signed === "1";
  const done = justSigned || c.already_signed;
  const addr = c.rendered_snapshot?.propertyAddress || "your new home";

  // The frozen lease, rendered exactly as it was hashed at send time.
  const leaseHtml = c.rendered_snapshot
    ? renderLeaseDocumentHtml(c.rendered_snapshot)
    : null;

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
        {done ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">Thank you — your lease is signed.</h1>
            <p className="mt-2 text-sm text-gray-600">
              {c.org_name} has recorded your electronic signature. You can keep
              this page or close it; a copy will be shared with you.
            </p>
          </div>
        ) : !c.signable ? (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-xl font-bold text-gray-900">
              This signing link is no longer active.
            </h1>
            <p className="mt-2 text-sm text-gray-600">
              {c.lease_status === "executed"
                ? "This lease has already been fully signed."
                : "The lease may have been withdrawn for changes. Please contact " +
                  c.org_name +
                  " if you were expecting to sign."}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900">Review &amp; sign your lease</h1>
              <p className="mt-1 text-sm text-gray-600">
                Hi {firstName(c.signer_name)}, {c.org_name} has prepared your lease
                for <span className="font-medium text-gray-800">{addr}</span>.
                Please read it in full, then sign below.
              </p>
            </div>

            {searchParams.error && (
              <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {ERROR_COPY[searchParams.error] ?? ERROR_COPY.failed}
              </p>
            )}

            {leaseHtml && (
              <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-100 px-4 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                  Lease document
                </div>
                <iframe
                  title="Lease document"
                  srcDoc={leaseHtml}
                  className="h-[60vh] w-full"
                />
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-bold text-gray-900">Sign the lease</h2>
              <SignatureForm token={c.token} brand={brand} />
            </div>
          </>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
