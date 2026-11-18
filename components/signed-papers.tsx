// S816: the signed rental applications and offers for one person or one renter,
// in one short list. Shown on the People page (follows the person into every
// tenancy) and on the tenancy page (the papers it came from). Server component.
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { offerTermLines } from "@/lib/application-offer";

type AppRow = {
  id: string;
  lead_id: string;
  status: string;
  applicant_name: string | null;
  signed_at: string | null;
  submitted_at: string | null;
  property: { address: string | null } | null;
};
type OfferRow = {
  id: string;
  lead_id: string;
  status: string;
  rent_cents: number;
  deposit_cents: number | null;
  start_date: string;
  term_months: number | null;
  accepted_at: string | null;
  created_at: string;
  property: { address: string | null } | null;
};

function day(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric" });
}

export async function SignedPapers({
  supabase,
  personId,
  leadIds,
}: {
  supabase: SupabaseClient;
  personId?: string | null;
  leadIds?: string[];
}) {
  let apps: AppRow[] = [];
  let offers: OfferRow[] = [];
  const appCols = "id, lead_id, status, applicant_name, signed_at, submitted_at, property:properties(address)";
  const offerCols =
    "id, lead_id, status, rent_cents, deposit_cents, start_date, term_months, accepted_at, created_at, property:properties(address)";

  if (personId) {
    const { data: a } = await supabase.from("rental_applications").select(appCols).eq("person_id", personId).neq("status", "requested");
    apps = (a ?? []) as unknown as AppRow[];
    const { data: sg } = await supabase.from("application_offer_signers").select("offer_id").eq("person_id", personId);
    const offerIds = ((sg ?? []) as { offer_id: string }[]).map((x) => x.offer_id);
    if (offerIds.length > 0) {
      const { data: o } = await supabase.from("application_offers").select(offerCols).in("id", offerIds);
      offers = (o ?? []) as unknown as OfferRow[];
    }
  } else if (leadIds && leadIds.length > 0) {
    const { data: a } = await supabase.from("rental_applications").select(appCols).in("lead_id", leadIds).neq("status", "requested");
    apps = (a ?? []) as unknown as AppRow[];
    const { data: o } = await supabase.from("application_offers").select(offerCols).in("lead_id", leadIds);
    offers = (o ?? []) as unknown as OfferRow[];
  }
  if (apps.length === 0 && offers.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-xs font-medium uppercase tracking-wider text-gray-500">Signed application and offer</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {apps.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-gray-800">
              Rental application{a.applicant_name ? `, ${a.applicant_name}` : ""}
              <span className="text-gray-500">
                {" "}
                · {a.signed_at ? `signed ${day(a.signed_at)}` : `submitted ${day(a.submitted_at)}`}
                {a.property?.address ? ` · ${a.property.address}` : ""}
              </span>
            </span>
            <a
              href={`/dashboard/leads/${a.lead_id}/application/print?app=${a.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-brand hover:underline"
            >
              Open
            </a>
          </li>
        ))}
        {offers.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-gray-800">
              Offer, {o.status === "accepted" ? `accepted ${day(o.accepted_at)}` : o.status}
              <span className="text-gray-500"> · {offerTermLines(o).slice(0, 2).join(", ")}</span>
            </span>
            <Link href={`/dashboard/leads/${o.lead_id}#offer`} className="text-sm font-medium text-brand hover:underline">
              Open
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
