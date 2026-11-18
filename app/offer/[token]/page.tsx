import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { offerTermLines } from "@/lib/application-offer";
import { signOffer } from "./actions";

export const dynamic = "force-dynamic";

type OfferShell = {
  ok?: boolean;
  signer_name?: string | null;
  signer_status?: string;
  signed_name?: string | null;
  offer_status?: string;
  signable?: boolean;
  rent_cents?: number;
  deposit_cents?: number | null;
  start_date?: string;
  term_months?: number | null;
  conditions?: string | null;
  landlord_signed_name?: string;
  landlord_signed_at?: string;
  property_address?: string | null;
  org_name?: string | null;
  brand_color?: string | null;
  brand_color_secondary?: string | null;
  logo_url?: string | null;
  others?: { name: string | null; status: string }[];
};

const ERRORS: Record<string, string> = {
  signature_required: "Please type your full name to sign.",
  agree_required: "Please tick the box to accept.",
  already_signed: "You have already answered this offer.",
  not_signable: "This offer is no longer open. Please contact the landlord.",
  not_found: "This link is no longer valid.",
  failed: "Something went wrong. Please try again.",
};

export default async function OfferPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { done?: string; error?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_application_offer_by_token", { p_token: params.token });
  const o = data as OfferShell | null;
  if (!o?.ok) notFound();

  const orgName = o.org_name || "The landlord";
  const brandBg = brandGradientCss(o.brand_color || DEFAULT_BRAND_COLOR, o.brand_color_secondary ?? null);
  const lines = offerTermLines({
    rent_cents: o.rent_cents ?? 0,
    deposit_cents: o.deposit_cents ?? null,
    start_date: o.start_date ?? "",
    term_months: o.term_months ?? null,
  });
  const err = searchParams.error ? ERRORS[searchParams.error] ?? ERRORS.failed : null;
  const others = o.others ?? [];

  return (
    <div className="min-h-screen bg-[#f4f4f5] px-4 py-8">
      <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="px-6 py-5 text-white" style={{ background: brandBg }}>
          {o.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={o.logo_url} alt={orgName} className="mb-2 max-h-10" />
          ) : null}
          <h1 className="text-lg font-semibold">Offer to rent</h1>
          <p className="text-sm text-white/85">
            {orgName}
            {o.property_address ? ` · ${o.property_address}` : ""}
          </p>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="text-sm text-gray-700">
            {o.signer_name ? `${o.signer_name.split(" ")[0]}, ` : ""}
            {orgName} is offering you this rental on these terms:
          </p>
          <ul className="space-y-1 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm font-medium text-gray-900">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {o.conditions ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-500">Conditions</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-gray-800">{o.conditions}</p>
            </div>
          ) : null}
          <p className="text-sm text-gray-600">
            Signed for the landlord by <span className="font-medium text-gray-900">{o.landlord_signed_name}</span>.
            Once everyone signs, {orgName} will prepare the lease for signing.
          </p>
          {others.length > 0 ? (
            <p className="text-sm text-gray-600">
              Also on this offer:{" "}
              {others
                .map((x) => `${x.name ?? "Co-applicant"} (${x.status === "signed" ? "signed" : x.status === "declined" ? "declined" : "not yet signed"})`)
                .join(", ")}
              .
            </p>
          ) : null}

          {searchParams.done === "signed" || o.signer_status === "signed" ? (
            <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Signed{o.signed_name ? ` by ${o.signed_name}` : ""}.{" "}
              {o.offer_status === "accepted"
                ? "Everyone has signed. The landlord will be in touch with the lease."
                : "We are waiting for the others to sign."}
            </p>
          ) : searchParams.done === "declined" || o.signer_status === "declined" ? (
            <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              You declined this offer. The landlord has been told.
            </p>
          ) : !o.signable ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This offer is no longer open. Please contact {orgName}.
            </p>
          ) : (
            <form action={signOffer} className="space-y-3 rounded-xl border border-gray-200 p-4">
              <input type="hidden" name="token" value={params.token} />
              {err ? (
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>
              ) : null}
              <label className="flex items-start gap-3 text-sm text-gray-700">
                <input type="checkbox" name="agree" value="1" className="mt-1 h-4 w-4" />
                <span>I accept this offer on the terms above. Typing my name is my electronic signature.</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Type your full name</span>
                <input
                  type="text"
                  name="signed_name"
                  required
                  autoComplete="name"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 font-serif text-lg italic"
                />
              </label>
              <button
                type="submit"
                name="decision"
                value="accept"
                className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white"
                style={{ background: brandBg }}
              >
                Sign and accept
              </button>
              <button
                type="submit"
                name="decision"
                value="decline"
                formNoValidate
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-600"
              >
                No thanks, decline
              </button>
              <p className="text-xs text-gray-500">We keep the date, time and device you sign from.</p>
            </form>
          )}
        </div>
      </div>
      <p className="mx-auto mt-4 max-w-xl text-center text-xs text-gray-400">
        <a href="https://www.vacantless.com/?ref=powered-by" target="_blank" rel="noopener" className="hover:underline">
          Powered by Vacantless
        </a>
      </p>
    </div>
  );
}
