import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { submitRentalApplication } from "./actions";

export const dynamic = "force-dynamic";

type AppShell = {
  ok?: boolean;
  status?: string;
  applicant_name?: string | null;
  applicant_email?: string | null;
  applicant_phone?: string | null;
  property_address?: string | null;
  org_name?: string | null;
  brand_color?: string | null;
  brand_color_secondary?: string | null;
  logo_url?: string | null;
  submitted?: boolean;
};

const ERROR_COPY: Record<string, string> = {
  consent_required: "Please tick the authorization box so we can process your application.",
  name_required: "Please enter your full legal name.",
  contact_required: "Please give an email or phone number so we can reach you.",
  already_submitted: "This application has already been submitted. Thank you!",
  not_found: "This application link is no longer valid.",
  server: "Something went wrong submitting your application. Please try again.",
  failed: "We couldn't submit your application. Please try again.",
};

export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { submitted?: string; error?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_rental_application_by_token", {
    p_token: params.token,
  });
  const app = data as AppShell | null;
  if (!app?.ok) notFound();

  const orgName = app.org_name || "the leasing team";
  const brand = app.brand_color || DEFAULT_BRAND_COLOR;
  const brandBg = brandGradientCss(brand, app.brand_color_secondary ?? null);
  const address = app.property_address ?? null;

  const submittedNow = searchParams.submitted === "1";
  const alreadyDone = app.submitted === true || app.status !== "requested";
  const errorKey = searchParams.error;
  const errorMsg = errorKey ? ERROR_COPY[errorKey] ?? "Please check your answers and try again." : null;

  return (
    <div className="min-h-screen bg-[#f4f4f5] py-8 px-4">
      <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="px-6 py-5 text-white" style={{ background: brandBg }}>
          {app.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={app.logo_url} alt={orgName} className="mb-2 max-h-10" />
          ) : null}
          <h1 className="text-lg font-semibold">Rental application</h1>
          <p className="text-sm text-white/85">
            {orgName}
            {address ? ` · ${address}` : ""}
          </p>
        </div>

        {submittedNow || alreadyDone ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700">
              &#10003;
            </div>
            <h2 className="text-lg font-semibold text-gray-900">Application received</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-600">
              Thanks{app.applicant_name ? `, ${app.applicant_name.split(" ")[0]}` : ""}. {orgName} has your
              application and will be in touch about next steps. You can close this page.
            </p>
          </div>
        ) : (
          <form action={submitRentalApplication} className="space-y-8 px-6 py-6">
            <input type="hidden" name="token" value={params.token} />

            {errorMsg ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                {errorMsg}
              </p>
            ) : null}

            <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
              This is the first step of your application. We will <strong>never</strong> ask for your SIN,
              date of birth, or banking details here. If a credit or background check is needed, you will
              receive a separate secure link from our screening partner.
            </p>

            <Section title="Your details">
              <Text name="applicant_name" label="Full legal name" required defaultValue={app.applicant_name ?? ""} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="applicant_email" label="Email" type="email" defaultValue={app.applicant_email ?? ""} />
                <Text name="applicant_phone" label="Phone" type="tel" defaultValue={app.applicant_phone ?? ""} />
              </div>
            </Section>

            <Section title="Current home">
              <Text name="current_address" label="Current address" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="current_duration" label="How long have you lived there?" />
                <Text name="current_rent" label="Current monthly rent" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="current_landlord_name" label="Current landlord name" />
                <Text name="current_landlord_contact" label="Landlord phone / email" />
              </div>
              <Text name="current_reason_leaving" label="Reason for leaving" />
            </Section>

            <Section title="Previous home (if less than 2 years at current)">
              <Text name="previous_address" label="Previous address" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="previous_duration" label="How long did you live there?" />
                <Text name="previous_landlord_name" label="Previous landlord name" />
              </div>
              <Text name="previous_landlord_contact" label="Previous landlord phone / email" />
            </Section>

            <Section title="Employment & income">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="employer" label="Employer" />
                <Text name="position" label="Position / title" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="employment_length" label="Length of employment" />
                <Text name="gross_income" label="Gross monthly income" />
              </div>
              <Text name="supervisor_contact" label="Supervisor / HR contact" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="second_employer" label="Second employer (optional)" />
                <Text name="second_income" label="Second income (optional)" />
              </div>
              <Text name="other_income" label="Other income sources (optional)" />
              <Text name="bank_reference_institution" label="Bank / financial institution (name only)" />
            </Section>

            <Section title="References">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="reference_1_name" label="Reference 1 name" />
                <Text name="reference_1_contact" label="Reference 1 phone / email" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="reference_2_name" label="Reference 2 name" />
                <Text name="reference_2_contact" label="Reference 2 phone / email" />
              </div>
            </Section>

            <Section title="Household">
              <Area name="occupants" label="Other occupants (name, age, relationship)" />
              <Text name="vehicles" label="Vehicle(s) — make, model, plate" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="smoking" label="Do you smoke? (yes / no)" />
                <Text name="pets" label="Pets (type, breed, weight)" />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Text name="emergency_contact_name" label="Emergency contact name" />
                <Text name="emergency_contact_phone" label="Emergency contact phone" />
              </div>
            </Section>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <label className="flex items-start gap-3 text-sm text-gray-700">
                <input type="checkbox" name="consent" value="1" required className="mt-1 h-4 w-4" />
                <span>
                  I certify the information above is true and complete, and I authorize {orgName} and its
                  screening partner to verify it and to obtain a consumer credit report and background/tenancy
                  history as part of processing this application (PIPEDA consent).
                </span>
              </label>
            </div>

            <button
              type="submit"
              className="w-full rounded-lg px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              style={{ background: brandBg }}
            >
              Submit application
            </button>
          </form>
        )}
      </div>
      <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-gray-400">
        Powered by Vacantless
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Text({
  name,
  label,
  type = "text",
  required = false,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
      />
    </label>
  );
}

function Area({ name, label }: { name: string; label: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <textarea
        name={name}
        rows={2}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-400 focus:outline-none"
      />
    </label>
  );
}
