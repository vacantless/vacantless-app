import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  TENANCY_STATUSES,
  tenancyStatusLabel,
  tenancyErrorMessage,
  parseDateOrNull,
  newTenancyEmptyState,
} from "@/lib/tenancy";
import { PageHeader, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import { createTenancy } from "../actions";
import { isPubliclyVisible } from "@/lib/listing-state";
import { LeaseUploadPrefill } from "./lease-upload-prefill";
import { getCurrentOrg } from "@/lib/org";
import { canUseLeaseOcr } from "@/lib/billing";
import { RentReconciliationFields } from "@/components/rent-reconciliation-fields";
import { leaseTermShiftEnabled } from "@/lib/rent-adjustments-server";

export const dynamic = "force-dynamic";

type PropertyOpt = {
  id: string;
  address: string;
  rent_cents: number | null;
  status: string;
};
type LeadPrefill = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  move_in: string | null;
  property_id: string | null;
  status: string;
};

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

export default async function NewTenancyPage({
  searchParams,
}: {
  searchParams: { from?: string; err?: string; property?: string; offer?: string };
}) {
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return null;

  const { data: propData } = await supabase
    .from("properties")
    .select("id, address, rent_cents, status")
    .eq("organization_id", org.id)
    .order("address", { ascending: true });
  const allProperties = (propData ?? []) as PropertyOpt[];

  // Convert flow: prefill from a leased lead.
  let lead: LeadPrefill | null = null;
  if (searchParams.from) {
    const { data } = await supabase
      .from("leads")
      .select("id, name, email, phone, move_in, property_id, status")
      .eq("id", searchParams.from)
      .eq("organization_id", org.id)
      .maybeSingle();
    lead = (data as LeadPrefill | null) ?? null;
  }

  const isConvert = lead != null;

  // S816: an accepted offer fills in the terms and every applicant who signed.
  type OfferPrefill = {
    id: string;
    rent_cents: number;
    deposit_cents: number | null;
    start_date: string;
    term_months: number | null;
    signers: { name: string | null; status: string; created_at: string; app: { applicant_email: string | null; applicant_phone: string | null } | null }[];
  };
  let offer: OfferPrefill | null = null;
  if (lead && searchParams.offer) {
    const { data } = await supabase
      .from("application_offers")
      .select(
        "id, rent_cents, deposit_cents, start_date, term_months, signers:application_offer_signers(name, status, created_at, app:rental_applications(applicant_email, applicant_phone))",
      )
      .eq("id", searchParams.offer)
      .eq("lead_id", lead.id)
      .eq("status", "accepted")
      .maybeSingle();
    offer = (data as unknown as OfferPrefill | null) ?? null;
  }
  const offerTenants = (offer?.signers ?? [])
    .filter((x) => x.status === "signed")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, 3)
    .map((x) => ({ name: x.name ?? "", email: x.app?.applicant_email ?? "", phone: x.app?.applicant_phone ?? "" }));
  const tenantDefault = (i: number, k: "name" | "email" | "phone"): string =>
    offerTenants.length > 0
      ? offerTenants[i]?.[k] ?? ""
      : i === 0
        ? (k === "name" ? lead?.name : k === "email" ? lead?.email : lead?.phone) ?? ""
        : "";
  // Preselect the unit: a converted lead's property wins; otherwise honor
  // ?property= from the rental lifecycle rail's Lease step (S282, IA G8 fix),
  // so "create the lease for this unit" lands with the unit already chosen.
  const defaultPropertyId = lead?.property_id ?? searchParams.property ?? "";

  // Units already carrying an active/upcoming tenancy are "spoken for" and must
  // not be offered again — listing one invited the double-booking bug where
  // 18 Shorncliffe (already actively tenanted) showed up in the picker (Codex QA).
  const { data: liveTenancyRows } = await supabase
    .from("tenancies")
    .select("property_id")
    .eq("organization_id", org.id)
    .in("status", ["active", "upcoming"]);
  const spokenFor = new Set(
    ((liveTenancyRows ?? []) as { property_id: string | null }[])
      .map((t) => t.property_id)
      .filter((id): id is string => !!id),
  );

  // A tenancy attaches to a real, in-use unit, so Draft and Off-market rentals
  // (e.g. a freshly duplicated "Copy of …" draft) don't belong in the picker —
  // listing them invited attaching a lease to a placeholder (S226 QA-audit) —
  // and neither do units that already have a live tenancy. Exception: keep the
  // convert-flow lead's own unit visible if it's just non-public (so the prefill
  // resolves), but NOT if it's already tenanted.
  const properties = allProperties.filter(
    (p) =>
      !spokenFor.has(p.id) &&
      // S705: off_market became publicly visible in S672; a retired unit
      // still does not belong in the lease picker.
      ((isPubliclyVisible(p.status) && p.status !== "off_market") ||
        // S807: a landlord who only collects rent adds occupied units as
        // private drafts (no ad needed), so drafts are offered too. A
        // duplicated "Copy of ..." placeholder still is not.
        (p.status === "draft" && !/^copy of /i.test(p.address ?? "")) ||
        p.id === defaultPropertyId),
  );

  // The pre-selected unit (convert flow, or ?property= from the lifecycle rail)
  // already has a live tenancy → we filtered it out; tell the operator why.
  const defaultUnitSpokenFor =
    defaultPropertyId !== "" && spokenFor.has(defaultPropertyId);
  const rawEmptyState = newTenancyEmptyState(allProperties.length, properties.length);
  // S834a: no rental at all is no longer a dead end. The form takes the
  // address itself (createTenancy makes a private unit), so a rent-only
  // landlord adds the tenant in one step.
  const typeAddress = rawEmptyState === "no_rentals";
  const emptyState = typeAddress ? null : rawEmptyState;
  // One rental to pick from: pick it.
  const pickedPropertyId =
    defaultPropertyId || (properties.length === 1 ? properties[0].id : "");

  const leadProperty = properties.find((p) => p.id === defaultPropertyId);
  const defaultRent = offer
    ? (offer.rent_cents / 100).toString()
    : leadProperty?.rent_cents != null
      ? (leadProperty.rent_cents / 100).toString()
      : "";
  const defaultStart =
    offer?.start_date || (lead?.move_in && parseDateOrNull(lead.move_in)) || "";

  const errMsg = tenancyErrorMessage(searchParams.err);
  const leaseTermShiftOn = leaseTermShiftEnabled();

  // Lease-OCR prefill ships DARK behind its OWN flag (not just the shared
  // ANTHROPIC_API_KEY, which already powers appliance-scan) so it can't auto-go-
  // live before the synthetic-lease QA. Noam sets LEASE_OCR_ENABLED=1 in Vercel
  // to turn the uploader on; the model call additionally needs ANTHROPIC_API_KEY.
  const leaseOcrEnabled = process.env.LEASE_OCR_ENABLED === "1";
  // Tier gate: entitled plans (Growth+) get the working uploader; others see the
  // locked upsell (the server action enforces this too).
  const leaseOcrEntitled = leaseOcrEnabled && canUseLeaseOcr(org.plan);

  return (
    <div>
      <Link
        href={isConvert ? `/dashboard/leads/${lead!.id}` : "/dashboard/tenancies"}
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← {isConvert ? "Back to inquiry" : "Tenancies"}
      </Link>

      <PageHeader
        icon={<Icons.key />}
        eyebrow={isConvert ? "Convert to tenancy" : "New tenancy"}
        title={isConvert ? "Review tenancy details" : "Add a tenancy"}
        subtitle={
          isConvert
            ? "We've prefilled what we know from the inquiry. Review and complete the lease details, then create the tenancy record."
            : "Record an active lease for a unit. The primary tenant is who rent collection will bill."
        }
      />

      {errMsg && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errMsg}
        </p>
      )}

      {defaultUnitSpokenFor && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {isConvert
            ? "This inquiry's rental already has an active or upcoming tenancy. End that tenancy first, or pick another rental below."
            : "That rental already has an active or upcoming tenancy. Pick another rental below."}
        </p>
      )}

      {emptyState ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">
          {/* S834a: "no_rentals" never reaches here; the form takes the address. */}
          <>
            No rental is ready for a new tenancy. Every active rental already has
            an active or upcoming tenancy, or the remaining rentals are not yet
            public.{" "}
            <Link href="/dashboard/tenancies" className="font-medium text-brand hover:underline">
              View tenancies
            </Link>
          </>
        </div>
      ) : (
        <>
        {leaseOcrEnabled && (
          <LeaseUploadPrefill
            properties={properties.map((p) => ({ id: p.id, address: p.address }))}
            entitled={leaseOcrEntitled}
          />
        )}
        <form
          action={createTenancy}
          className="space-y-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          {isConvert && <input type="hidden" name="lead_id" value={lead!.id} />}
          {offer && <input type="hidden" name="offer_id" value={offer.id} />}
          {offer && (
            <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              Filled in from the signed offer. Check it and save.
            </p>
          )}

          {/* Unit + dates ------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {typeAddress ? (
                <>
                  <label htmlFor="tenancy-new-address" className={labelCls}>
                    Rental address
                  </label>
                  <input
                    id="tenancy-new-address"
                    type="text"
                    name="new_property_address"
                    required
                    minLength={5}
                    autoComplete="street-address"
                    placeholder="123 Main St, Unit 2, Toronto ON"
                    className={inputCls}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Private: no ad and no public page. You can add photos and post it later if it ever comes up for rent.
                  </p>
                </>
              ) : (
              <>
              <label htmlFor="tenancy-property-id" className={labelCls}>
                Rental (unit)
              </label>
              <select
                id="tenancy-property-id"
                name="property_id"
                required
                defaultValue={pickedPropertyId}
                className={inputCls}
              >
                <option value="">Select a rental…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.address}
                  </option>
                ))}
              </select>
              </>
              )}
            </div>
            <div>
              <label htmlFor="tenancy-start-date" className={labelCls}>
                Lease start
              </label>
              <input
                id="tenancy-start-date"
                type="date"
                name="start_date"
                required
                defaultValue={defaultStart}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="tenancy-end-date" className={labelCls}>
                Lease end (optional)
              </label>
              <input
                id="tenancy-end-date"
                type="date"
                name="end_date"
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="tenancy-term-months" className={labelCls}>
                Term (months, blank = month-to-month)
              </label>
              <input
                id="tenancy-term-months"
                type="number"
                name="term_months"
                step="1"
                min="1"
                placeholder="12"
                defaultValue={offer?.term_months ?? undefined}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="tenancy-status" className={labelCls}>
                Status
              </label>
              <select
                id="tenancy-status"
                name="status"
                defaultValue="active"
                className={inputCls}
              >
                {TENANCY_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tenancyStatusLabel(s)}
                  </option>
                ))}
              </select>
              {/* B2 / M14: the Status choice silently decides whether the unit
                  comes off the market. Say so at the point of decision. */}
              <p className="mt-1 text-xs text-gray-500">
                Active or Upcoming takes this rental off its public listing page
                and stops new inquiries. Ended records a past lease and leaves
                the listing as it is.
              </p>
            </div>
          </div>

          {/* Money -------------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tenancy-rent" className={labelCls}>
                Monthly rent ($)
              </label>
              <input
                id="tenancy-rent"
                type="number"
                name="rent"
                step="0.01"
                min="0"
                placeholder="1250"
                defaultValue={defaultRent}
                className={inputCls}
              />
              {isConvert && leadProperty?.rent_cents != null && (
                <p className="mt-1 text-xs text-gray-400">Prefilled from the unit. Edit if the signed rent differs.</p>
              )}
            </div>
            <div>
              <label htmlFor="tenancy-deposit" className={labelCls}>
                Deposit ($, optional)
              </label>
              <input
                id="tenancy-deposit"
                type="number"
                name="deposit"
                step="0.01"
                min="0"
                placeholder="1250"
                defaultValue={offer?.deposit_cents != null ? offer.deposit_cents / 100 : undefined}
                className={inputCls}
              />
            </div>
          </div>

          {leaseTermShiftOn && (
            <RentReconciliationFields
              rentInputId="tenancy-rent"
              source="lease_ocr"
              visible={false}
              title="Confirm the current rent from this lease"
              description="Lease OCR can find the original rent. Confirm whether that is still the rent the tenant pays today before rent-increase tracking starts."
            />
          )}

          {/* Tenants ------------------------------------------------------ */}
          <div>
            <p className="mb-1 text-sm font-semibold text-gray-700">Tenants</p>
            <p className="mb-3 text-xs text-gray-500">
              Add up to three. Mark one as primary. That&apos;s who rent collection bills.
            </p>
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 sm:grid-cols-[auto_1fr_1fr_1fr]"
                >
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
                    <input
                      type="radio"
                      name="primary_index"
                      value={i}
                      defaultChecked={i === 0}
                    />
                    Primary
                  </label>
                  <label htmlFor={`tenant-name-${i}`} className="sr-only">
                    {i === 0 ? "Primary tenant name" : `Co-tenant ${i} name`}
                  </label>
                  <input
                    id={`tenant-name-${i}`}
                    name="tenant_name"
                    placeholder={i === 0 ? "Full name" : "Co-tenant name (optional)"}
                    defaultValue={tenantDefault(i, "name")}
                    className={inputCls}
                  />
                  <label htmlFor={`tenant-email-${i}`} className="sr-only">
                    {i === 0 ? "Primary tenant email" : `Co-tenant ${i} email`}
                  </label>
                  <input
                    id={`tenant-email-${i}`}
                    name="tenant_email"
                    type="email"
                    placeholder="Email"
                    defaultValue={tenantDefault(i, "email")}
                    className={inputCls}
                  />
                  <label htmlFor={`tenant-phone-${i}`} className="sr-only">
                    {i === 0 ? "Primary tenant phone" : `Co-tenant ${i} phone`}
                  </label>
                  <input
                    id={`tenant-phone-${i}`}
                    name="tenant_phone"
                    placeholder="Phone"
                    defaultValue={tenantDefault(i, "phone")}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Notes -------------------------------------------------------- */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tenancy-payment-notes" className={labelCls}>
                Payment / deposit notes
              </label>
              <textarea
                id="tenancy-payment-notes"
                name="payment_notes"
                rows={2}
                className={inputCls}
              />
            </div>
            <div>
              <label htmlFor="tenancy-move-in-notes" className={labelCls}>
                Move-in notes
              </label>
              <textarea
                id="tenancy-move-in-notes"
                name="move_in_notes"
                rows={2}
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="tenancy-notes" className={labelCls}>
                Other notes
              </label>
              <textarea
                id="tenancy-notes"
                name="notes"
                rows={2}
                className={inputCls}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              Create tenancy
            </button>
            <Link
              href={isConvert ? `/dashboard/leads/${lead!.id}` : "/dashboard/tenancies"}
              className={SECONDARY_ACTION_CLASS}
            >
              Cancel
            </Link>
          </div>
        </form>
        </>
      )}
    </div>
  );
}
