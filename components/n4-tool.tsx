"use client";

// S755: the free Ontario N4 filler. No sign-in. The arrears table and dates
// compute in the browser with lib/n4-tool.ts; the download link calls a route
// that recomputes everything on the server from the same inputs.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  centsToDollars,
  computeN4Tool,
  longDate,
  moneyToCents,
  monthsBetween,
  n4FormReady,
  n4Query,
  n4ResultSentence,
  N4_TOOL_PATH,
  N4_TOOL_SIGNUP_HREF,
  SERVICE_METHODS,
  type N4ToolInput,
  type ServiceMethod,
} from "@/lib/n4-tool";
import { formatPeriodMonth } from "@/lib/payments";

type Props = {
  /** Today's date in Toronto (YYYY-MM-DD), from the server so the page is stable. */
  today: string;
};

const field =
  "w-full rounded-lg border border-[#c9d4ce] bg-white px-3 py-2.5 text-[1rem] text-[#15211d] outline-none focus:border-[#16756a] focus:ring-2 focus:ring-[#16756a]/20";
const label = "mb-1 block text-[0.86rem] font-bold text-[#384a42]";
const button =
  "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[0.95rem] font-bold transition";

export function N4Tool({ today }: Props) {
  const [rent, setRent] = useState("");
  const [firstMonth, setFirstMonth] = useState("");
  const [served, setServed] = useState(today);
  const [method, setMethod] = useState<ServiceMethod>("hand");
  const [paid, setPaid] = useState<Record<string, string>>({});
  const [landlord, setLandlord] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [tenants, setTenants] = useState("");
  const [address, setAddress] = useState("");

  const months = useMemo(
    () =>
      /^\d{4}-\d{2}$/.test(firstMonth) && /^\d{4}-\d{2}-\d{2}$/.test(served)
        ? monthsBetween(firstMonth, served).slice(0, 24)
        : [],
    [firstMonth, served],
  );

  const input: N4ToolInput | null = useMemo(() => {
    const rentCents = moneyToCents(rent);
    if (rentCents == null || !/^\d{4}-\d{2}$/.test(firstMonth) || !/^\d{4}-\d{2}-\d{2}$/.test(served)) return null;
    const paidCents = months.map((m) => moneyToCents(paid[m] ?? "", true) ?? -1);
    if (paidCents.some((c) => c < 0)) return null;
    return {
      rentCents,
      firstMonth,
      paidCents,
      serviceDate: served,
      method,
      landlordName: landlord.trim(),
      signerFirstName: firstName.trim(),
      signerLastName: lastName.trim(),
      phone: phone.trim(),
      tenantNames: tenants
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 4),
      address: address.trim(),
    };
  }, [rent, firstMonth, served, method, paid, months, landlord, firstName, lastName, phone, tenants, address]);

  const outcome = useMemo(() => (input ? computeN4Tool(input, today) : null), [input, today]);
  const result = outcome && outcome.ok ? outcome.result : null;
  const canFill = !!(input && result && n4FormReady(input));
  const query = input ? n4Query(input) : "";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-[1.2rem] font-extrabold tracking-tight">1. What is owed</h2>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="n4-rent">
                Monthly rent
              </label>
              <input
                id="n4-rent"
                className={field}
                inputMode="decimal"
                placeholder="1,500"
                value={rent}
                onChange={(e) => setRent(e.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="n4-first">
                First month not paid in full
              </label>
              <input
                id="n4-first"
                className={field}
                type="month"
                value={firstMonth}
                onChange={(e) => setFirstMonth(e.target.value)}
              />
            </div>
          </div>

          {months.length > 0 && (
            <div className="rounded-xl border border-[#d9e1dc] p-3">
              <p className="mb-2 text-[0.86rem] font-bold text-[#384a42]">
                Paid toward each month (leave blank if nothing)
              </p>
              <div className="grid gap-2">
                {months.map((m) => (
                  <div key={m} className="grid grid-cols-[1fr_140px] items-center gap-3">
                    <span className="text-[0.93rem]">{formatPeriodMonth(`${m}-01`)}</span>
                    <input
                      aria-label={`Paid toward ${formatPeriodMonth(`${m}-01`)}`}
                      className={field}
                      inputMode="decimal"
                      placeholder="0"
                      value={paid[m] ?? ""}
                      onChange={(e) => setPaid((p) => ({ ...p, [m]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="n4-served">
                Day you give the notice
              </label>
              <input
                id="n4-served"
                className={field}
                type="date"
                min={today}
                value={served}
                onChange={(e) => setServed(e.target.value)}
              />
            </div>
            <div>
              <label className={label} htmlFor="n4-method">
                How you give it
              </label>
              <select
                id="n4-method"
                className={field}
                value={method}
                onChange={(e) => setMethod(e.target.value as ServiceMethod)}
              >
                {SERVICE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[0.82rem] text-[#59655f]">
                {SERVICE_METHODS.find((m) => m.value === method)?.note}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[#16756a]/30 bg-[#edf5f0] p-4">
          {!outcome ? (
            <p className="text-[0.95rem] text-[#384a42]">
              Enter the rent and the first unpaid month and the answer appears here.
            </p>
          ) : !outcome.ok ? (
            <p className="text-[0.95rem] font-bold text-[#8a4b00]">{outcome.error}</p>
          ) : (
            <>
              <p className="text-[1.05rem] font-bold leading-snug text-[#15211d]">
                {n4ResultSentence(outcome.result)}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.9rem] sm:grid-cols-3">
                <div>
                  <dt className="text-[#59655f]">Rent owing</dt>
                  <dd className="font-bold">{centsToDollars(outcome.result.totalOwingCents)}</dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Counts as given</dt>
                  <dd className="font-bold">{longDate(outcome.result.deemedServiceDate)}</dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Termination date</dt>
                  <dd className="font-bold">{longDate(outcome.result.terminationDate)}</dd>
                </div>
              </dl>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[0.85rem]">
                  <caption className="mb-1 text-left text-[0.82rem] font-bold text-[#384a42]">
                    The table on the form
                  </caption>
                  <thead>
                    <tr className="border-b border-[#c9d4ce] text-left text-[#59655f]">
                      <th className="py-1 pr-2 font-bold">From</th>
                      <th className="py-1 pr-2 font-bold">To</th>
                      <th className="py-1 pr-2 font-bold">Charged</th>
                      <th className="py-1 pr-2 font-bold">Paid</th>
                      <th className="py-1 font-bold">Owing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outcome.result.formRows.map((r) => (
                      <tr key={r.fromISO} className="border-b border-[#dfe8e2]">
                        <td className="py-1 pr-2">{longDate(r.fromISO)}</td>
                        <td className="py-1 pr-2">{longDate(r.toISO)}</td>
                        <td className="py-1 pr-2">{centsToDollars(r.chargedCents)}</td>
                        <td className="py-1 pr-2">{centsToDollars(r.paidCents)}</td>
                        <td className="py-1 font-bold">{centsToDollars(r.owingCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {outcome.result.combined && (
                  <p className="mt-2 text-[0.82rem] text-[#384a42]">
                    The form has three rows, so the earlier months share the first row and the
                    latest month has its own, as the Board&apos;s instructions say.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-1 text-[1.2rem] font-extrabold tracking-tight">2. Fill the Form N4</h2>
        <p className="mb-4 text-[0.9rem] text-[#59655f]">
          We fill the Landlord and Tenant Board&apos;s current N4 (2026/09) with the numbers on
          the left. You sign it and give it to the tenant.
        </p>
        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="n4-landlord">
              Landlord name (as on the lease)
            </label>
            <input id="n4-landlord" className={field} value={landlord} onChange={(e) => setLandlord(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="n4-tenants">
              Tenant names (separate with commas)
            </label>
            <input id="n4-tenants" className={field} value={tenants} onChange={(e) => setTenants(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="n4-address">
              Rental unit address
            </label>
            <input
              id="n4-address"
              className={field}
              placeholder="12 Main St, Unit 3, Windsor, ON N8Y 3B4"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="n4-fn">
                Your first name
              </label>
              <input id="n4-fn" className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n4-ln">
                Your last name
              </label>
              <input id="n4-ln" className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n4-phone">
                Your phone
              </label>
              <input id="n4-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            className={`${button} ${canFill ? "bg-[#16756a] text-white hover:bg-[#125f56]" : "pointer-events-none bg-[#d9e1dc] text-[#7a867f]"}`}
            href={canFill ? `${N4_TOOL_PATH}/official?${query}` : undefined}
            aria-disabled={!canFill}
            target="_blank"
            rel="noopener"
          >
            Download the filled N4 (PDF)
          </a>
        </div>
        {!canFill && (
          <p className="mt-2 text-[0.82rem] text-[#59655f]">
            {result
              ? "Enter the landlord name, the tenant names and the address to turn on the download."
              : "Finish step 1 to turn on the download."}
          </p>
        )}
        <p className="mt-3 text-[0.82rem] text-[#59655f]">
          Check every field before you serve it. Remove the landlord checklist page first. This
          tool is not legal advice.
        </p>

        <div className="mt-6 rounded-xl bg-[#15211d] p-4 text-white">
          <p className="text-[0.98rem] font-bold">Keep the rent and the paperwork in one place.</p>
          <p className="mt-1 text-[0.88rem] text-white/80">
            On any paid plan, Vacantless fills the N4 from the tenancy and the payments you
            record, along with the N5, N12, L1 and other Board forms. Start free with one rental.
          </p>
          <Link
            href={N4_TOOL_SIGNUP_HREF}
            className={`${button} mt-3 bg-white text-[#15211d] hover:bg-[#edf5f0]`}
          >
            Start free
          </Link>
        </div>
      </section>
    </div>
  );
}
