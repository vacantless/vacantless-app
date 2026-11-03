import type { ReactNode } from "react";
import Link from "next/link";
import { LEASE_TOOL_PATH, LEASE_TOOL_SIGNUP_HREF } from "@/lib/standard-lease-tool";
import { STANDARD_LEASE_VERSION } from "@/lib/standard-lease-pdf";
import {
  MarketingCta,
  MarketingFooter,
  MarketingHeader,
} from "../../../components/marketing-chrome";

// S746c: the free Ontario Standard Lease (2229E) filler, engine 1 tool 2. A plain
// form, no sign-in, no JavaScript; POST goes to ./pdf which fills the government
// form with lib/standard-lease-pdf.ts, the same fill the signed-in lease uses.
// Field names match lib/standard-lease.ts detailsFromForm.

export const metadata = {
  title: "Ontario Standard Lease (Form 2229E) filled in online, free",
  description:
    "Fill Ontario's Standard Form of Lease online and download the official 2229E PDF with every section completed. Free, no sign-in, nothing stored.",
  alternates: { canonical: "https://www.vacantless.com/tools/standard-lease" },
};

const inputCls =
  "w-full rounded-lg border border-[#c9d4ce] bg-white px-3 py-2.5 text-[0.98rem] text-[#15211d] outline-none focus:border-[#16756a] focus:ring-2 focus:ring-[#16756a]/20";

function Text({ name, label, placeholder, area, type, required }: { name: string; label: string; placeholder?: string; area?: boolean; type?: string; required?: boolean }) {
  return (
    <label className="block space-y-1">
      <span className="text-[0.86rem] font-bold text-[#384a42]">{label}</span>
      {area ? (
        <textarea name={name} placeholder={placeholder} rows={3} className={inputCls} />
      ) : (
        <input name={name} type={type ?? "text"} placeholder={placeholder} required={required} className={inputCls} />
      )}
    </label>
  );
}

function Choice({ name, label, options, defaultValue }: { name: string; label: string; options: [string, string][]; defaultValue?: string }) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-[0.86rem] font-bold text-[#384a42]">{label}</legend>
      <div className="flex flex-wrap gap-4">
        {options.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5 text-[0.95rem] text-[#384a42]">
            <input type="radio" name={name} value={v} defaultChecked={defaultValue === v} className="accent-[#16756a]" /> {l}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const YN: [string, string][] = [["yes", "Yes"], ["no", "No"]];
const WHO: [string, string][] = [["landlord", "Landlord"], ["tenant", "Tenant"]];
const COST: [string, string][] = [["no_charge", "No charge"], ["pay_per_use", "Pay per use"]];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
      <h2 className="text-[1.1rem] font-extrabold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

const FAQ: { q: string; a: string }[] = [
  {
    q: "Who has to use the Ontario Standard Lease?",
    a: "Most private residential tenancies signed on or after April 30, 2018. It does not apply to care homes, mobile home parks and land lease communities, most social and supportive housing, and co-operative housing.",
  },
  {
    q: "Is this the real government form?",
    a: `Yes. The download is Ontario's Standard Form of Lease, ${STANDARD_LEASE_VERSION}, with your answers written into the official fields. Your additional terms print as the attachment Section 15 points to.`,
  },
  {
    q: "What happens after we sign?",
    a: "Give the tenant a copy of the signed lease within 21 days. Keep one for yourself. The rent deposit can be at most one month's rent and can only be used for the last month's rent.",
  },
  {
    q: "Can I add my own rules?",
    a: "Yes, in Additional terms. They cannot take away a right the Residential Tenancies Act gives the tenant; a term that does is void even if both of you sign it.",
  },
];

export default function StandardLeaseToolPage() {
  return (
    <div className="min-h-screen bg-[#f6faf7] text-[#15211d]">
      <MarketingHeader />
      <main>
        <section className="border-b border-[#d9e1dc] bg-gradient-to-b from-white to-[#edf5f0]/90">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] pb-10 pt-14">
            <p className="mb-4 text-[0.79rem] font-extrabold uppercase tracking-[0.08em] text-[#16756a]">
              Free tool for Ontario landlords
            </p>
            <h1 className="mb-[18px] max-w-[22ch] text-[clamp(2rem,4.2vw,3rem)] font-extrabold leading-[1.05] tracking-tight">
              Ontario Standard Lease, filled in and ready to sign.
            </h1>
            <p className="max-w-[58ch] text-[clamp(1.02rem,1.5vw,1.15rem)] leading-relaxed text-[#384a42]">
              Answer the questions below and download the official Form 2229E with every section
              completed. No account, nothing stored. Print it or sign it on paper.
            </p>
          </div>
        </section>

        <section className="py-10">
          <form method="post" action={`${LEASE_TOOL_PATH}/pdf`} target="_blank" className="mx-auto grid w-[min(920px,calc(100%-32px))] gap-5">
            <Section title="1. Who and where">
              <Text name="landlord_name" label="Landlord's legal name" placeholder="As it should appear on the lease" required />
              <div className="grid gap-3 sm:grid-cols-2">
                <Text name="tenant1" label="Tenant 1" required />
                <Text name="tenant2" label="Tenant 2" />
                <Text name="tenant3" label="Tenant 3" />
                <Text name="tenant4" label="Tenant 4" />
              </div>
              <Text name="address" label="Rental unit address" placeholder="Unit 2, 12 Main St, Windsor ON N9A 1A1" required />
              <Text name="parking" label="Parking spaces and description" placeholder="1 outdoor space, rear lot, spot 4" />
              <Choice name="is_condo" label="Is the unit in a condominium?" options={YN} />
            </Section>

            <Section title="3. Landlord's address for notices">
              <div className="grid gap-3 sm:grid-cols-4">
                <Text name="notice_unit" label="Unit" />
                <Text name="notice_street_number" label="Street number" />
                <div className="sm:col-span-2"><Text name="notice_street_name" label="Street name" /></div>
                <Text name="notice_po_box" label="PO Box" />
                <Text name="notice_city" label="City" />
                <Text name="notice_province" label="Province" placeholder="Ontario" />
                <Text name="notice_postal_code" label="Postal code" />
              </div>
              <Choice name="email_notices" label="Can notices and documents be sent by email?" options={YN} />
              <Text name="email_addresses" label="Email addresses for notices" />
              <Choice name="emergency_contact" label="Do you give a phone or email for emergencies and day-to-day contact?" options={YN} />
              <Text name="emergency_contact_info" label="That phone or email" />
            </Section>

            <Section title="4. Term">
              <div className="grid gap-3 sm:grid-cols-3">
                <Text name="start_date" label="Tenancy starts" type="date" required />
                <Choice name="term" label="Term" options={[["fixed", "Fixed term"], ["monthly", "Month to month"]]} defaultValue="fixed" />
                <Text name="end_date" label="Fixed term ends" type="date" />
              </div>
            </Section>

            <Section title="5. Rent">
              <div className="grid gap-3 sm:grid-cols-3">
                <Text name="rent" label="Rent ($ per month)" placeholder="1,500" required />
                <Text name="rent_due_day" label="Paid on the ___ day" placeholder="first" />
                <Text name="deposit" label="Rent deposit ($, blank for none)" placeholder="1,500" />
              </div>
              <Choice name="rent_period" label="Each" options={[["month", "Month"], ["other", "Other"]]} defaultValue="month" />
              <Text name="rent_period_other" label="If other, which period" placeholder="weekly" />
              <Text name="parking_rent" label="Parking charge per month ($)" />
              <div className="grid gap-3 sm:grid-cols-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="contents">
                    <Text name={`charge${i}_label`} label={`Other charge ${i}`} placeholder="Storage locker" />
                    <Text name={`charge${i}_amount`} label="Per month ($)" />
                  </div>
                ))}
              </div>
              <Text name="payable_to" label="Rent is payable to" />
              <Text name="payment_methods" label="How rent is paid" placeholder="E-transfer or pre-authorized debit" />
              <div className="grid gap-3 sm:grid-cols-4">
                <Text name="partial_rent" label="First partial rent ($)" />
                <Text name="partial_paid_on" label="Paid on" type="date" />
                <Text name="partial_from" label="Covers from" type="date" />
                <Text name="partial_to" label="To" type="date" />
              </div>
              <Text name="nsf_charge" label="NSF admin charge ($, $20 at most)" />
            </Section>

            <Section title="6. Services and utilities">
              <p className="text-[0.9rem] text-[#59655f]">Included in the rent?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice name="gas" label="Gas" options={YN} />
                <Choice name="air_conditioning" label="Air conditioning" options={YN} />
                <Choice name="storage" label="Extra storage space" options={YN} />
                <Choice name="laundry" label="On-site laundry" options={YN} />
                <Choice name="laundry_charge" label="Laundry cost" options={COST} />
                <Choice name="guest_parking" label="Guest parking" options={YN} />
                <Choice name="guest_parking_charge" label="Guest parking cost" options={COST} />
              </div>
              {[1, 2].map((i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-2">
                  <Text name={`service${i}_label`} label={`Other service ${i}`} />
                  <Choice name={`service${i}_included`} label="Included?" options={YN} />
                </div>
              ))}
              <Text name="services_details" label="Details about services" area />
              <p className="text-[0.9rem] text-[#59655f]">Who pays?</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Choice name="electricity" label="Electricity" options={WHO} />
                <Choice name="heat" label="Heat" options={WHO} />
                <Choice name="water" label="Water" options={WHO} />
              </div>
              <Text name="utilities_details" label="Details of the tenant's utilities" area placeholder="Tenant opens the hydro account before move-in." />
            </Section>

            <Section title="7 to 11. Discounts, deposits, smoking, insurance">
              <Text name="rent_discount" label="Rent discount (leave blank for none)" area />
              <Text name="key_deposit" label="Refundable key deposit ($, blank for none)" />
              <Text name="key_deposit_details" label="Keys, cards and remotes covered" />
              <Text name="smoking_rules" label="Smoking rules (leave blank for none)" area />
              <Choice name="tenant_insurance" label="Must the tenant have liability insurance?" options={YN} />
            </Section>

            <Section title="15. Additional terms">
              <Text name="additional_terms" label="Your own terms (printed as the attachment, leave blank for none)" area placeholder="No pets of any kind are kept in the unit. Tenant keeps the walkway clear of snow." />
            </Section>

            <div className="rounded-2xl border border-[#16756a]/30 bg-[#edf5f0] p-5 sm:p-6">
              <button type="submit" className="inline-flex items-center justify-center rounded-lg bg-[#16756a] px-5 py-3 text-[1rem] font-bold text-white hover:bg-[#125f56]">
                Download the filled lease (PDF)
              </button>
              <p className="mt-3 text-[0.86rem] text-[#59655f]">
                The form prints with any blank answers left blank; fill them by hand before signing.
                Check every page. This tool is not legal advice.
              </p>
            </div>
          </form>
        </section>

        <section className="py-8">
          <div className="mx-auto w-[min(920px,calc(100%-32px))] rounded-2xl bg-[#15211d] p-6 text-white">
            <p className="text-[1.05rem] font-bold">Sign it online, keep it on file, never miss the rent increase.</p>
            <p className="mt-1 text-[0.92rem] text-white/80">
              In a free Vacantless account the lease fills from the tenancy, both of you sign on
              your phones, and the yearly rent-increase notice is ready when the law allows it.
            </p>
            <Link href={LEASE_TOOL_SIGNUP_HREF} className="mt-4 inline-flex rounded-lg bg-white px-4 py-2.5 text-[0.95rem] font-bold text-[#15211d] hover:bg-[#edf5f0]">
              Start free
            </Link>
          </div>
        </section>

        <section className="py-10">
          <div className="mx-auto w-[min(920px,calc(100%-32px))]">
            <h2 className="mb-6 text-[1.5rem] font-extrabold tracking-tight">Common questions</h2>
            <dl className="grid gap-5">
              {FAQ.map((f) => (
                <div key={f.q}>
                  <dt className="text-[1.02rem] font-extrabold">{f.q}</dt>
                  <dd className="mt-1 text-[0.95rem] leading-relaxed text-[#384a42]">{f.a}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-6 text-[0.86rem] text-[#59655f]">
              Source: Ontario&apos;s{" "}
              <a className="underline hover:text-[#15211d]" href="https://www.ontario.ca/page/guide-ontarios-standard-lease" target="_blank" rel="noopener">
                guide to the standard lease
              </a>
              . Also available: the{" "}
              <Link className="underline hover:text-[#15211d]" href="/tools/rent-increase">rent increase calculator with Form N1</Link>.
            </p>
          </div>
        </section>

        <MarketingCta
          title="Fill the next vacancy the same easy way."
          body="Vacantless is the leasing tool built by working landlords. Renters book their own viewings, every inquiry lands in one list, and the lease and rent-increase forms fill themselves."
        />
      </main>
      <MarketingFooter />
    </div>
  );
}
