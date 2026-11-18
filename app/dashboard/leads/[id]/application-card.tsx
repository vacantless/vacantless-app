// S816: the renter's application and offer, in one card. Every applicant on
// this renter (co-applicants too), each one's signature and credit check, the
// offer and its signatures, and the step into the tenancy. Server component.
import Link from "next/link";
import { CopyTextButton } from "@/components/copy-text-button";
import { applicantStatusLabel } from "@/lib/rental-application";
import { ltbSearchUrl, CREDIT_CHECK_ONE_LINE, CREDIT_CHECK_ONTARIO_LINE, LTB_CHECK_LINE } from "@/lib/credit-check";
import { offerTermLines, offerStatusLabel, OFFER_ERRORS, fmtDollars } from "@/lib/application-offer";
import {
  requestRentalApplication,
  setCreditCheck,
  withdrawRentalApplication,
  sendApplicationOffer,
  withdrawApplicationOffer,
} from "../actions";

export type CardApplication = {
  id: string;
  status: string;
  public_token: string;
  applicant_name: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  requested_at: string | null;
  submitted_at: string | null;
  signed_at: string | null;
  signed_name: string | null;
  credit_check_status: string | null;
  person_id: string | null;
};

export type CardOffer = {
  id: string;
  status: string;
  rent_cents: number;
  deposit_cents: number | null;
  start_date: string;
  term_months: number | null;
  conditions: string | null;
  landlord_signed_name: string;
  landlord_signed_at: string;
  tenancy_id: string | null;
  signers: { id: string; name: string | null; status: string; signed_at: string | null; token: string }[];
};

const BANNERS: Record<string, { tone: "ok" | "warn" | "err"; text: string }> = {
  sent: { tone: "ok", text: "Application sent. They got an email with their link." },
  made: { tone: "ok", text: "Application ready. They have no email on file, so copy their link below and text it." },
  exists: { tone: "warn", text: "That person already has an open application here." },
  contact: { tone: "err", text: "Add an email or phone number for that person first." },
  error: { tone: "err", text: "Couldn't create the application. Please try again." },
  upgrade: { tone: "warn", text: "Rental applications come with Starter and up." },
  ext_sent: { tone: "ok", text: "Application link sent. They got an email with your own application form." },
  ext_copy: { tone: "warn", text: "They have no email on file, so copy your application link below and text it." },
  credit_emailed: { tone: "ok", text: "Credit check asked for. They got an email with your credit check link." },
  credit_copy: { tone: "warn", text: "Credit check asked for. They have no email on file, so copy their link below and text it." },
  credit_nolink: {
    tone: "warn",
    text: "Marked as asked for. Add your credit check company's link in Settings and they will see it on their application page.",
  },
};

const btn =
  "rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90";
const btnStyle = { background: "var(--brand-gradient, var(--brand-color))" };
const small =
  "rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50";
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

function fmt(iso: string | null, tz: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-CA", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function bannerClass(t: "ok" | "warn" | "err") {
  return t === "ok"
    ? "border-green-200 bg-green-50 text-green-800"
    : t === "err"
      ? "border-red-200 bg-red-50 text-red-700"
      : "border-amber-200 bg-amber-50 text-amber-800";
}

export function ApplicationCard(p: {
  leadId: string;
  lead: { name: string | null; email: string | null; phone: string | null; move_in: string | null };
  rentCents: number | null;
  applications: CardApplication[];
  offer: CardOffer | null;
  canApplications: boolean;
  appUrl: string;
  timeZone: string;
  applyBanner: string | null;
  offerBanner: string | null;
  offerError: string | null;
  screeningName: string | null;
  hasScreeningLink: boolean;
  ontario: boolean;
  /** S818b: the account's own application form (Buildium and the like). */
  ownForm: { url: string; name: string | null } | null;
  tenancyId: string | null;
}) {
  const banner = p.applyBanner ? BANNERS[p.applyBanner] ?? null : null;
  const open = p.applications.filter((a) => a.status !== "declined");
  const signed = open.filter((a) => a.status !== "requested");
  const offer = p.offer;
  const offerOpen = offer && (offer.status === "sent" || offer.status === "accepted");

  if (!p.canApplications) {
    return (
      <div id="application" className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">Application and offer</h3>
        <p className="mt-3 text-sm text-gray-500">
          Signed rental applications and offers are part of{" "}
          <span className="font-medium text-gray-700">Starter and up</span>.{" "}
          <Link href="/dashboard/billing" className="font-medium text-brand hover:underline">
            Upgrade
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div id="application" className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      {banner && (
        <p className={`mb-3 rounded-lg border px-3 py-2 text-sm ${bannerClass(banner.tone)}`}>{banner.text}</p>
      )}
      <h3 className="text-xs font-medium uppercase tracking-wider text-gray-500">Application and offer</h3>

      {/* 1. Applicants */}
      {open.length === 0 && p.ownForm ? (
        <div className="mt-3 space-y-2">
          <form action={requestRentalApplication} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={p.leadId} />
            <button type="submit" className={btn} style={btnStyle} disabled={!p.lead.email && !p.lead.phone}>
              Send your {p.ownForm.name || "own"} application{p.lead.name ? ` to ${p.lead.name.split(" ")[0]}` : ""}
            </button>
            <CopyTextButton value={p.ownForm.url} label="Copy the link" />
          </form>
          <p className="text-xs text-gray-500">
            {p.lead.email ? `Emails your application form to ${p.lead.email}, with this rental's address. ` : ""}
            Applications come back in {p.ownForm.name || "your own system"}, not here.{" "}
            <Link href="/dashboard/settings?tab=brand#application-form" className="text-brand hover:underline">
              Change it
            </Link>
          </p>
        </div>
      ) : open.length === 0 ? (
        <form action={requestRentalApplication} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="id" value={p.leadId} />
          <button type="submit" className={btn} style={btnStyle} disabled={!p.lead.email && !p.lead.phone}>
            Send application{p.lead.name ? ` to ${p.lead.name.split(" ")[0]}` : ""}
          </button>
          <span className="text-xs text-gray-500">
            {p.lead.email
              ? `Emails a link to ${p.lead.email}. They fill it in and sign by typing their name.`
              : p.lead.phone
                ? "No email on file: you'll get a link to text them."
                : "Add an email or phone for this renter first."}
          </span>
        </form>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {open.map((a) => {
            const label = applicantStatusLabel(a);
            const link = `${p.appUrl}/apply/${a.public_token}`;
            return (
              <li key={a.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {a.applicant_name ?? "Applicant"}{" "}
                      <span
                        className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                          label === "Signed" || label === "Submitted"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {label}
                        {a.signed_at ? ` ${fmt(a.signed_at, p.timeZone)}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                      {a.applicant_phone ? (
                        <a href={`tel:${a.applicant_phone}`} className="hover:underline">
                          {a.applicant_phone}
                        </a>
                      ) : null}
                      {a.applicant_email ? (
                        <a href={`mailto:${a.applicant_email}`} className="hover:underline">
                          {a.applicant_email}
                        </a>
                      ) : null}
                      {a.person_id ? (
                        <Link href={`/dashboard/people/${a.person_id}`} className="text-brand hover:underline">
                          All their papers
                        </Link>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.status === "requested" ? (
                      <CopyTextButton value={link} label="Copy their link" />
                    ) : (
                      <a
                        href={`/dashboard/leads/${p.leadId}/application/print?app=${a.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={small}
                      >
                        Open signed application
                      </a>
                    )}
                    <form action={withdrawRentalApplication}>
                      <input type="hidden" name="id" value={p.leadId} />
                      <input type="hidden" name="application_id" value={a.id} />
                      <button type="submit" className="text-xs text-gray-400 hover:text-red-600">
                        Withdraw
                      </button>
                    </form>
                  </div>
                </div>
                {a.status !== "requested" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    {p.ontario && ltbSearchUrl(a.applicant_name) ? (
                      <a
                        href={ltbSearchUrl(a.applicant_name) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={small}
                        title={LTB_CHECK_LINE}
                      >
                        Check LTB orders (free)
                      </a>
                    ) : null}
                    <span>Credit check:</span>
                    {(["asked", "received"] as const).map((st) => (
                      <form key={st} action={setCreditCheck}>
                        <input type="hidden" name="id" value={p.leadId} />
                        <input type="hidden" name="application_id" value={a.id} />
                        <input type="hidden" name="state" value={a.credit_check_status === st ? "" : st} />
                        <button
                          type="submit"
                          className={`rounded-full border px-2.5 py-0.5 ${
                            a.credit_check_status === st
                              ? "border-green-300 bg-green-50 font-semibold text-green-800"
                              : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                          }`}
                        >
                          {st === "asked" ? (a.credit_check_status === "asked" ? "Asked for" : "Ask for credit check") : "Received"}
                        </button>
                      </form>
                    ))}
                    {a.credit_check_status === "asked" && p.hasScreeningLink ? (
                      <CopyTextButton value={link} label="Copy their link" />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {open.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium text-brand">+ Add another applicant</summary>
          <form action={requestRentalApplication} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input type="hidden" name="id" value={p.leadId} />
            <input name="co_name" placeholder="Name" className={input} required />
            <input name="co_email" type="email" placeholder="Email" className={input} />
            <input name="co_phone" type="tel" placeholder="Phone" className={input} />
            <div className="sm:col-span-3">
              <button type="submit" className={btn} style={btnStyle}>
                Send them an application
              </button>
              <span className="ml-2 text-xs text-gray-500">Each adult signs their own.</span>
            </div>
          </form>
        </details>
      ) : null}

      <p className="mt-3 text-xs text-gray-500">
        {CREDIT_CHECK_ONE_LINE}{" "}
        {p.ontario ? `${CREDIT_CHECK_ONTARIO_LINE} ` : ""}
        {p.hasScreeningLink ? `Your link: ${p.screeningName || "credit check company"}. ` : "Add your credit check company's link first. "}
        <Link href="/dashboard/settings?tab=brand#credit-check" className="text-brand hover:underline">
          {p.hasScreeningLink ? "Change it" : "Add it in Settings"}
        </Link>
      </p>
      {p.ontario && signed.length > 0 ? <p className="mt-1 text-xs text-gray-500">{LTB_CHECK_LINE}</p> : null}

      {/* 2. Offer */}
      <div id="offer" className="mt-5 border-t border-gray-100 pt-4">
        <h4 className="text-xs font-medium uppercase tracking-wider text-gray-500">Offer</h4>
        {p.offerBanner === "sent" ? (
          <p className={`mt-2 rounded-lg border px-3 py-2 text-sm ${bannerClass("ok")}`}>
            Offer sent. Each applicant got their own link to sign.
          </p>
        ) : null}
        {p.offerError ? (
          <p className={`mt-2 rounded-lg border px-3 py-2 text-sm ${bannerClass("err")}`}>
            {OFFER_ERRORS[p.offerError] ?? "Couldn't send the offer. Please try again."}
          </p>
        ) : null}

        {offer && offerOpen ? (
          <div className="mt-2 space-y-2 text-sm">
            <p className="font-medium text-gray-900">
              {offerStatusLabel(
                offer.status,
                offer.signers.filter((s) => s.status === "signed").length,
                offer.signers.length,
              )}
            </p>
            <p className="text-gray-700">{offerTermLines(offer).join(" · ")}</p>
            {offer.conditions ? <p className="whitespace-pre-wrap text-gray-600">{offer.conditions}</p> : null}
            <p className="text-xs text-gray-500">
              Signed for you by {offer.landlord_signed_name} {fmt(offer.landlord_signed_at, p.timeZone)}
            </p>
            <ul className="space-y-1">
              {offer.signers.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-gray-800">{s.name ?? "Applicant"}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      s.status === "signed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {s.status === "signed" ? `Signed ${fmt(s.signed_at, p.timeZone)}` : "Not signed yet"}
                  </span>
                  {s.status === "pending" ? (
                    <CopyTextButton value={`${p.appUrl}/offer/${s.token}`} label="Copy their offer link" />
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {offer.status === "accepted" ? (
                offer.tenancy_id || p.tenancyId ? (
                  <Link href={`/dashboard/tenancies/${offer.tenancy_id ?? p.tenancyId}`} className={btn} style={btnStyle}>
                    Open their tenant record
                  </Link>
                ) : (
                  <Link
                    href={`/dashboard/tenancies/new?from=${p.leadId}&offer=${offer.id}`}
                    className={btn}
                    style={btnStyle}
                  >
                    Add them as tenants, filled in from the offer
                  </Link>
                )
              ) : (
                <form action={withdrawApplicationOffer}>
                  <input type="hidden" name="id" value={p.leadId} />
                  <input type="hidden" name="offer_id" value={offer.id} />
                  <button type="submit" className="text-xs text-gray-500 hover:text-red-600">
                    Withdraw the offer
                  </button>
                </form>
              )}
            </div>
          </div>
        ) : signed.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            {offer ? `The last offer was ${offer.status}. ` : ""}
            Once someone signs their application, you can send them an offer here.
          </p>
        ) : (
          <form action={sendApplicationOffer} className="mt-2 space-y-3">
            <input type="hidden" name="id" value={p.leadId} />
            {offer ? <p className="text-sm text-gray-500">The last offer was {offer.status}. Send a new one:</p> : null}
            <p className="text-sm text-gray-600">
              Goes to {signed.map((a) => a.applicant_name ?? "applicant").join(" and ")}. Each signs with their name.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="block">
                <span className="mb-1 block text-xs text-gray-600">Rent a month</span>
                <input
                  name="rent"
                  inputMode="decimal"
                  required
                  defaultValue={p.rentCents != null ? String(p.rentCents / 100) : ""}
                  className={input}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-600">Deposit</span>
                <input
                  name="deposit"
                  inputMode="decimal"
                  defaultValue={p.rentCents != null ? String(p.rentCents / 100) : ""}
                  className={input}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-600">Start date</span>
                <input name="start_date" type="date" required defaultValue={p.lead.move_in ?? ""} className={input} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-gray-600">Term (months)</span>
                <input name="term_months" inputMode="numeric" defaultValue="12" className={input} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-gray-600">Conditions (optional)</span>
              <textarea
                name="conditions"
                rows={2}
                placeholder="For example: tenant insurance before move-in; first and last month's rent on signing."
                className={input}
              />
            </label>
            <label className="block sm:w-1/2">
              <span className="mb-1 block text-xs text-gray-600">Type your name to sign the offer</span>
              <input name="landlord_name" required className={`${input} font-serif italic`} />
            </label>
            <button type="submit" className={btn} style={btnStyle}>
              Sign and send the offer
            </button>
            {p.rentCents != null ? (
              <p className="text-xs text-gray-500">Rent and deposit start at the listed rent, {fmtDollars(p.rentCents)}.</p>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
