import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { postLeaseRouteWalled } from "@/lib/post-lease-surface";
import { loadStandardLease } from "@/lib/standard-lease-server";
import {
  formMoney,
  isOntarioRental,
  standardLeaseMissing,
  standardLeaseProblems,
  type StandardLeaseDetails,
} from "@/lib/standard-lease";
import { PageShell, StatusBanner, ButtonLink, Button } from "@/components/ui";
import { saveStandardLeaseDetails } from "./actions";

export const dynamic = "force-dynamic";

// S743: the details Ontario's Standard Form of Lease (2229E) asks for that the
// tenancy does not hold, then a download of the filled government form.

const inputCls =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-[var(--vl-accent)] focus:outline-none";

function Text({ name, label, value, placeholder, area }: { name: string; label: string; value?: string | null; placeholder?: string; area?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      {area ? (
        <textarea name={name} defaultValue={value ?? ""} placeholder={placeholder} rows={3} className={inputCls} />
      ) : (
        <input name={name} defaultValue={value ?? ""} placeholder={placeholder} className={inputCls} />
      )}
    </label>
  );
}

function Choice({ name, label, value, options }: { name: string; label: string; value: string | null | undefined; options: [string, string][] }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-gray-800">{label}</legend>
      <div className="flex flex-wrap gap-4">
        {options.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="radio" name={name} value={v} defaultChecked={value === v} /> {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const YN: [string, string][] = [["yes", "Yes"], ["no", "No"]];
const boolVal = (b: boolean | null | undefined) => (b === true ? "yes" : b === false ? "no" : null);
const money = (c: number | null | undefined) => (c ? formMoney(c) : "");

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

export default async function StandardLeasePage({
  params,
  searchParams,
}: {
  params: { id: string; leaseId: string };
  searchParams: { saved?: string };
}) {
  if (await postLeaseRouteWalled()) notFound();
  await requireCapability("manage_tenancies");
  const org = await getCurrentOrg();
  if (!org) redirect("/login");
  const loaded = await loadStandardLease(createClient(), {
    tenancyId: params.id, leaseId: params.leaseId, orgId: org.id, orgName: org.name,
  });
  if (!loaded) notFound();
  const { input } = loaded;
  const d: StandardLeaseDetails = input.details;
  const missing = standardLeaseMissing(input);
  const problems = standardLeaseProblems(input);
  const editable = loaded.status === "draft";
  const pdfHref = `/dashboard/tenancies/${params.id}/lease/${params.leaseId}/standard/pdf`;
  const charges = [...(d.otherCharges ?? []), {}, {}, {}, {}].slice(0, 4) as { label?: string; cents?: number }[];
  const services = [...(d.otherServices ?? []), {}, {}, {}].slice(0, 3) as { label?: string; included?: string | null }[];

  return (
    <PageShell
      title="Ontario Standard Lease"
      subtitle={`Form 2229E for ${input.propertyAddress ?? "this rental"}. Your lease terms are attached as Section 15.`}
      action={<ButtonLink href={pdfHref} target="_blank" rel="noopener noreferrer">Download the lease (PDF)</ButtonLink>}
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href={`/dashboard/tenancies/${params.id}?open=lease-document#lease-document`} className="text-sm text-gray-600 underline">
          Back to the tenancy
        </Link>
        {!isOntarioRental(input.propertyAddress) && (
          <StatusBanner tone="attention" title="This rental is not in Ontario">
            Form 2229E is Ontario&apos;s lease. Use your province&apos;s form instead.
          </StatusBanner>
        )}
        {searchParams.saved === "1" && <StatusBanner tone="success" title="Saved" />}
        {searchParams.saved === "error" && <StatusBanner tone="attention" title="Not saved. Try again." />}
        {searchParams.saved === "locked" && (
          <StatusBanner tone="attention" title="This lease was sent, so its details are fixed." />
        )}
        {loaded.carried && editable && (
          <StatusBanner tone="info" title="Filled in from your last lease">Check each answer, then save.</StatusBanner>
        )}
        {missing.length > 0 && (
          <StatusBanner tone="attention" title="Still to answer">
            {missing.join(", ")}. The form prints without them, but leave none blank before you send it.
          </StatusBanner>
        )}
        {problems.length > 0 && (
          <StatusBanner tone="attention" title="Fix before you send">{problems.join(" ")}</StatusBanner>
        )}
        <p className="text-sm text-gray-600">
          From the tenancy: {input.tenantNames.join(", ") || "no tenants yet"}; rent ${formMoney(input.rentCents) || "not set"};
          deposit {input.depositCents ? `$${formMoney(input.depositCents)}` : "none"}; starts {input.startDate ?? "not set"}
          {input.endDate ? `, ends ${input.endDate}` : ", monthly"}. Change these on the tenancy.
        </p>

        <form action={saveStandardLeaseDetails} className="space-y-4">
          <input type="hidden" name="tenancy_id" value={params.id} />
          <input type="hidden" name="lease_id" value={params.leaseId} />
          <fieldset disabled={!editable} className="space-y-4">
            <Section title="1 and 2. Landlord and rental unit">
              <Text name="landlord_legal_name" label="Landlord's legal name" value={d.landlordLegalName ?? org.name} />
              <Text name="parking" label="Parking spaces and description" value={d.parking} placeholder="1 outdoor space, rear lot, spot 4" />
              <Choice name="is_condo" label="Is the unit in a condominium?" value={boolVal(d.isCondo)} options={YN} />
            </Section>

            <Section title="3. Contact information">
              <p className="text-sm text-gray-600">Address for notices to the landlord.</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <Text name="notice_unit" label="Unit" value={d.noticeUnit} />
                <Text name="notice_street_number" label="Street number" value={d.noticeStreetNumber} />
                <div className="sm:col-span-2"><Text name="notice_street_name" label="Street name" value={d.noticeStreetName} /></div>
                <Text name="notice_po_box" label="PO Box" value={d.noticePoBox} />
                <Text name="notice_city" label="City" value={d.noticeCity} />
                <Text name="notice_province" label="Province" value={d.noticeProvince ?? "Ontario"} />
                <Text name="notice_postal_code" label="Postal code" value={d.noticePostalCode} />
              </div>
              <Choice name="email_notices" label="Can notices and documents be sent by email?" value={boolVal(d.emailNotices)} options={YN} />
              <Text name="email_addresses" label="Email addresses for notices" value={d.emailAddresses} />
              <Choice name="emergency_contact" label="Do you give a phone or email for emergencies and day-to-day contact?" value={boolVal(d.emergencyContact)} options={YN} />
              <Text name="emergency_contact_info" label="That phone or email" value={d.emergencyContactInfo} />
            </Section>

            <Section title="5. Rent">
              <Text name="rent_due_day" label="Rent is paid on the ___ day" value={d.rentDueDay ?? "first"} />
              <Choice name="rent_period" label="Each" value={d.rentPeriod ?? "month"} options={[["month", "Month"], ["other", "Other"]]} />
              <Text name="rent_period_other" label="If other, which period" value={d.rentPeriodOther} placeholder="weekly" />
              <Text name="parking_rent" label="Parking charge per month ($)" value={money(d.parkingRentCents)} />
              <div className="grid gap-3 sm:grid-cols-2">
                {charges.map((ch, i) => (
                  <div key={i} className="contents">
                    <Text name={`charge${i + 1}_label`} label={`Other charge ${i + 1}`} value={ch.label} placeholder="Storage locker" />
                    <Text name={`charge${i + 1}_amount`} label="Per month ($)" value={money(ch.cents)} />
                  </div>
                ))}
              </div>
              <Text name="payable_to" label="Rent is payable to" value={d.payableTo} placeholder={d.landlordLegalName ?? org.name} />
              <Text name="payment_methods" label="How rent is paid" value={d.paymentMethods} placeholder="E-transfer or pre-authorized debit" />
              <div className="grid gap-3 sm:grid-cols-4">
                <Text name="partial_rent" label="First partial rent ($)" value={money(d.partialRentCents)} />
                <Text name="partial_paid_on" label="Paid on (yyyy-mm-dd)" value={d.partialRentPaidOn} />
                <Text name="partial_from" label="Covers from" value={d.partialFrom} />
                <Text name="partial_to" label="To" value={d.partialTo} />
              </div>
              <Text name="nsf_charge" label="NSF admin charge ($, $20 at most)" value={money(d.nsfChargeCents)} />
            </Section>

            <Section title="6. Services and utilities">
              <p className="text-sm text-gray-600">Included in the rent?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice name="gas" label="Gas" value={d.gas} options={YN} />
                <Choice name="air_conditioning" label="Air conditioning" value={d.airConditioning} options={YN} />
                <Choice name="storage" label="Extra storage space" value={d.storage} options={YN} />
                <Choice name="laundry" label="On-site laundry" value={d.laundry} options={YN} />
                <Choice name="laundry_charge" label="Laundry cost" value={d.laundryCharge} options={[["no_charge", "No charge"], ["pay_per_use", "Pay per use"]]} />
                <Choice name="guest_parking" label="Guest parking" value={d.guestParking} options={YN} />
                <Choice name="guest_parking_charge" label="Guest parking cost" value={d.guestParkingCharge} options={[["no_charge", "No charge"], ["pay_per_use", "Pay per use"]]} />
              </div>
              {services.map((sv, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-2">
                  <Text name={`service${i + 1}_label`} label={`Other service ${i + 1}`} value={sv.label} />
                  <Choice name={`service${i + 1}_included`} label="Included?" value={sv.included ?? null} options={YN} />
                </div>
              ))}
              <Text name="services_details" label="Details about services" value={d.servicesDetails} area />
              <p className="text-sm text-gray-600">Who pays?</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Choice name="electricity" label="Electricity" value={d.electricity} options={[["landlord", "Landlord"], ["tenant", "Tenant"]]} />
                <Choice name="heat" label="Heat" value={d.heat} options={[["landlord", "Landlord"], ["tenant", "Tenant"]]} />
                <Choice name="water" label="Water" value={d.water} options={[["landlord", "Landlord"], ["tenant", "Tenant"]]} />
              </div>
              <Text name="utilities_details" label="Details of the tenant's utilities" value={d.utilitiesDetails} area placeholder="Tenant opens the hydro account before move-in." />
            </Section>

            <Section title="7 to 11. Discounts, deposits, smoking, insurance">
              <Text name="rent_discount" label="Rent discount (leave blank for none)" value={d.rentDiscount} area />
              <Text name="key_deposit" label="Refundable key deposit ($, blank for none)" value={money(d.keyDepositCents)} />
              <Text name="key_deposit_details" label="Keys, cards and remotes covered" value={d.keyDepositDetails} />
              <Text name="smoking_rules" label="Smoking rules (leave blank for none)" value={d.smokingRules} area />
              <Choice name="tenant_insurance" label="Must the tenant have liability insurance?" value={boolVal(d.tenantInsuranceRequired)} options={YN} />
            </Section>
          </fieldset>
          {editable && <Button type="submit">Save</Button>}
        </form>
      </div>
    </PageShell>
  );
}
