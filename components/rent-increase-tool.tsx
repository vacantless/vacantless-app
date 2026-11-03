"use client";

// S746: the free Ontario rent-increase calculator and Form N1 filler.
// No sign-in. Everything computes in the browser with the same pure engine the
// signed-in product uses; the two download links call routes that rebuild the
// result on the server from the same inputs, so nothing here can be spoofed into
// a different number on the form.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  centsToDollars,
  computeTool,
  dollarsToCents,
  longDate,
  resultSentence,
  TOOL_PATH,
  TOOL_SIGNUP_HREF,
  toolQuery,
  type ToolInput,
} from "@/lib/rent-increase-tool";

type Props = {
  /** Guideline percent by effective year, merged on the server. */
  guideline: Record<string, number>;
  /** Today's date in Toronto (YYYY-MM-DD), from the server so the page is stable. */
  today: string;
};

const field =
  "w-full rounded-lg border border-[#c9d4ce] bg-white px-3 py-2.5 text-[1rem] text-[#15211d] outline-none focus:border-[#16756a] focus:ring-2 focus:ring-[#16756a]/20";
const label = "mb-1 block text-[0.86rem] font-bold text-[#384a42]";
const button =
  "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[0.95rem] font-bold transition";

export function RentIncreaseTool({ guideline, today }: Props) {
  const [rent, setRent] = useState("");
  const [start, setStart] = useState("");
  const [exempt, setExempt] = useState(false);
  const [effective, setEffective] = useState("");
  const [newRent, setNewRent] = useState("");
  const [landlord, setLandlord] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tenants, setTenants] = useState("");
  const [address, setAddress] = useState("");

  const lookup = useMemo(
    () => (year: number) => {
      const v = guideline[String(year)];
      return typeof v === "number" ? v : null;
    },
    [guideline],
  );

  const input: ToolInput | null = useMemo(() => {
    const rentCents = dollarsToCents(rent);
    if (rentCents == null || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
    return {
      rentCents,
      baseDate: start,
      exempt,
      wantedEffectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(effective) ? effective : null,
      chosenNewRentCents: exempt ? dollarsToCents(newRent) : null,
      landlordName: landlord.trim(),
      landlordPhone: phone.trim(),
      landlordEmail: email.trim(),
      tenantNames: tenants
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 4),
      address: address.trim(),
    };
  }, [rent, start, exempt, effective, newRent, landlord, phone, email, tenants, address]);

  const result = useMemo(
    () => (input ? computeTool(input, today, lookup) : null),
    [input, today, lookup],
  );

  const canFill = !!(input && result && result.newRentCents != null);
  const query = input ? toolQuery(input) : "";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-[1.2rem] font-extrabold tracking-tight">1. Your tenancy</h2>
        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="ri-rent">
              Current monthly rent
            </label>
            <input
              id="ri-rent"
              className={field}
              inputMode="decimal"
              placeholder="1,500"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
            />
          </div>
          <div>
            <label className={label} htmlFor="ri-start">
              Move-in date, or the date of the last rent increase
            </label>
            <input
              id="ri-start"
              className={field}
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2.5 text-[0.93rem] text-[#384a42]">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-[#16756a]"
              checked={exempt}
              onChange={(e) => setExempt(e.target.checked)}
            />
            <span>
              This unit was first lived in after November 15, 2018 (new build, new addition or
              new basement apartment). The guideline cap does not apply.
            </span>
          </label>
          {exempt && (
            <div>
              <label className={label} htmlFor="ri-newrent">
                New monthly rent you have chosen
              </label>
              <input
                id="ri-newrent"
                className={field}
                inputMode="decimal"
                placeholder="1,600"
                value={newRent}
                onChange={(e) => setNewRent(e.target.value)}
              />
            </div>
          )}
          <div>
            <label className={label} htmlFor="ri-effective">
              Day you want the new rent to start (optional)
            </label>
            <input
              id="ri-effective"
              className={field}
              type="date"
              value={effective}
              onChange={(e) => setEffective(e.target.value)}
            />
            <p className="mt-1 text-[0.82rem] text-[#59655f]">
              Most landlords pick the first of a month. Leave it blank for the earliest legal day.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[#16756a]/30 bg-[#edf5f0] p-4">
          {!result ? (
            <p className="text-[0.95rem] text-[#384a42]">
              Enter the rent and the date and the answer appears here.
            </p>
          ) : (
            <>
              <p className="text-[1.05rem] font-bold leading-snug text-[#15211d]">
                {resultSentence(result)}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.9rem] sm:grid-cols-4">
                <div>
                  <dt className="text-[#59655f]">Guideline</dt>
                  <dd className="font-bold">
                    {result.exempt
                      ? "Not capped"
                      : result.guidelinePercent == null
                        ? "Not published"
                        : `${result.guidelinePercent}%`}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">New rent</dt>
                  <dd className="font-bold">
                    {result.newRentCents == null ? "Your choice" : centsToDollars(result.newRentCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Starts</dt>
                  <dd className="font-bold">{longDate(result.effectiveDate)}</dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Give notice by</dt>
                  <dd className="font-bold">{longDate(result.serveByDate)}</dd>
                </div>
              </dl>
              {result.wantedTooEarly && (
                <p className="mt-3 text-[0.88rem] text-[#8a4b00]">
                  The day you picked is too soon. Rent can rise once every 12 months and the
                  tenant needs 90 days of notice, so the earliest legal day is shown instead.
                </p>
              )}
              {result.status === "overdue" && !result.exempt && (
                <p className="mt-3 text-[0.88rem] text-[#384a42]">
                  You could have raised the rent from {longDate(result.earliestEffectiveDate)}.
                  There is no catching up: the increase starts 90 days after the notice.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-1 text-[1.2rem] font-extrabold tracking-tight">2. Fill the Form N1</h2>
        <p className="mb-4 text-[0.9rem] text-[#59655f]">
          We fill the official Landlord and Tenant Board form with the numbers above. You sign it
          and give it to the tenant.
        </p>
        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="ri-landlord">
              Landlord name (as on the lease)
            </label>
            <input id="ri-landlord" className={field} value={landlord} onChange={(e) => setLandlord(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="ri-tenants">
              Tenant names (separate with commas)
            </label>
            <input id="ri-tenants" className={field} value={tenants} onChange={(e) => setTenants(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="ri-address">
              Rental unit address
            </label>
            <input id="ri-address" className={field} value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="ri-phone">
                Your phone (optional)
              </label>
              <input id="ri-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="ri-email">
                Your email (optional)
              </label>
              <input id="ri-email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            className={`${button} ${canFill ? "bg-[#16756a] text-white hover:bg-[#125f56]" : "pointer-events-none bg-[#d9e1dc] text-[#7a867f]"}`}
            href={canFill ? `${TOOL_PATH}/n1/official?${query}` : undefined}
            aria-disabled={!canFill}
            target="_blank"
            rel="noopener"
          >
            Download the filled N1 (PDF)
          </a>
          <a
            className={`${button} ${canFill ? "border border-[#16756a] text-[#16756a] hover:bg-[#edf5f0]" : "pointer-events-none border border-[#d9e1dc] text-[#7a867f]"}`}
            href={canFill ? `${TOOL_PATH}/n1?${query}` : undefined}
            aria-disabled={!canFill}
            target="_blank"
            rel="noopener"
          >
            Print a review copy
          </a>
        </div>
        {!canFill && (
          <p className="mt-2 text-[0.82rem] text-[#59655f]">
            {result && result.exempt && result.newRentCents == null
              ? "Enter the new rent you have chosen to fill the form."
              : result && result.guidelineMissing
                ? "The form can be filled once Ontario publishes that year's guideline."
                : "Finish step 1 to turn on the downloads."}
          </p>
        )}
        <p className="mt-3 text-[0.82rem] text-[#59655f]">
          Check every field before you serve it. This tool is not legal advice.
        </p>

        <div className="mt-6 rounded-xl bg-[#15211d] p-4 text-white">
          <p className="text-[0.98rem] font-bold">Never miss next year&apos;s increase.</p>
          <p className="mt-1 text-[0.88rem] text-white/80">
            Add this tenancy to a free Vacantless account. We email you 120 days before the next
            increase is allowed, with the N1 filled in and ready to print.
          </p>
          <Link
            href={TOOL_SIGNUP_HREF}
            className={`${button} mt-3 bg-white text-[#15211d] hover:bg-[#edf5f0]`}
          >
            Start free
          </Link>
        </div>
      </section>
    </div>
  );
}
