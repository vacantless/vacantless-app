"use client";

// S757: the free Ontario N8 filler (persistent late rent). No sign-in. The count
// and dates compute in the browser with lib/n8-tool.ts; the download link calls
// a route that recomputes everything on the server from the same inputs.

import { useMemo, useState } from "react";
import Link from "next/link";
import { SERVICE_METHODS, longDate, moneyToCents } from "@/lib/n4-tool";
import {
  N8_TOOL_PATH,
  N8_TOOL_SIGNUP_HREF,
  computeN8Tool,
  n8MonthsToAsk,
  n8Query,
  n8ResultSentence,
  type N8ToolInput,
} from "@/lib/n8-tool";
import { N8_RULE_FROM } from "@/lib/n8";
import type { N12ServiceMethod } from "@/lib/n12";
import { formatPeriodMonth } from "@/lib/payments";

const field =
  "w-full rounded-lg border border-[#c9d4ce] bg-white px-3 py-2.5 text-[1rem] text-[#15211d] outline-none focus:border-[#16756a] focus:ring-2 focus:ring-[#16756a]/20";
const label = "mb-1 block text-[0.86rem] font-bold text-[#384a42]";
const button = "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[0.95rem] font-bold transition";

export function N8Tool({ today }: { today: string }) {
  const [rent, setRent] = useState("");
  const [served, setServed] = useState(today);
  const [method, setMethod] = useState<N12ServiceMethod>("hand");
  const [paidOn, setPaidOn] = useState<Record<string, string>>({});
  const [term, setTerm] = useState("");
  const [end, setEnd] = useState("");
  const [landlord, setLandlord] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [tenants, setTenants] = useState("");
  const [address, setAddress] = useState("");

  const months = useMemo(() => (/^\d{4}-\d{2}-\d{2}$/.test(served) ? n8MonthsToAsk(served) : []), [served]);

  const input: N8ToolInput | null = useMemo(() => {
    const rentCents = moneyToCents(rent);
    if (rentCents == null || !/^\d{4}-\d{2}-\d{2}$/.test(served)) return null;
    const p: Record<string, string> = {};
    for (const m of months) if (/^\d{4}-\d{2}-\d{2}$/.test(paidOn[m] ?? "")) p[m] = paidOn[m];
    return {
      rentCents,
      serviceDate: served,
      method,
      paidOn: p,
      fixedTermEnd: /^\d{4}-\d{2}-\d{2}$/.test(term) ? term : null,
      terminationDate: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null,
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
  }, [rent, served, method, paidOn, months, term, end, landlord, firstName, lastName, phone, tenants, address]);

  const outcome = useMemo(() => (input ? computeN8Tool(input, today) : null), [input, today]);
  const result = outcome && outcome.ok ? outcome.result : null;
  const canFill = !!(result && result.problems.length === 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-[1.2rem] font-extrabold tracking-tight">1. When the rent came in</h2>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="n8-rent">
                Monthly rent (due on the 1st)
              </label>
              <input id="n8-rent" className={field} inputMode="decimal" placeholder="1,250" value={rent} onChange={(e) => setRent(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n8-served">
                Day you give the notice
              </label>
              <input id="n8-served" className={field} type="date" min={today} value={served} onChange={(e) => setServed(e.target.value)} />
            </div>
          </div>
          {months.length > 0 && (
            <div className="rounded-xl border border-[#d9e1dc] p-3">
              <p className="mb-2 text-[0.86rem] font-bold text-[#384a42]">
                The day each month&apos;s rent was paid in full (leave blank if it came on time)
              </p>
              <div className="grid gap-2">
                {months.map((m) => (
                  <div key={m} className="grid grid-cols-[1fr_170px] items-center gap-3">
                    <span className="text-[0.93rem]">
                      {formatPeriodMonth(`${m}-01`)}
                      {`${m}-01` < N8_RULE_FROM && <span className="ml-1 text-[0.78rem] text-[#59655f]">(history only)</span>}
                    </span>
                    <input
                      aria-label={`Paid in full for ${formatPeriodMonth(`${m}-01`)}`}
                      className={field}
                      type="date"
                      min={`${m}-01`}
                      max={served}
                      value={paidOn[m] ?? ""}
                      onChange={(e) => setPaidOn((p) => ({ ...p, [m]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="n8-method">
                How you give it
              </label>
              <select id="n8-method" className={field} value={method} onChange={(e) => setMethod(e.target.value as N12ServiceMethod)}>
                {SERVICE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[0.82rem] text-[#59655f]">{SERVICE_METHODS.find((m) => m.value === method)?.note}</p>
            </div>
            <div>
              <label className={label} htmlFor="n8-term">
                Fixed term ends (blank if month to month)
              </label>
              <input id="n8-term" className={field} type="date" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          </div>
          <div>
            <label className={label} htmlFor="n8-end">
              Termination date (blank = the earliest allowed)
            </label>
            <input id="n8-end" className={field} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[#16756a]/30 bg-[#edf5f0] p-4">
          {!outcome ? (
            <p className="text-[0.95rem] text-[#384a42]">Enter the rent and the day you give the notice, then the days rent came in late.</p>
          ) : !outcome.ok ? (
            <p className="text-[0.95rem] font-bold text-[#8a4b00]">{outcome.error}</p>
          ) : (
            <>
              <p className="text-[1.05rem] font-bold leading-snug text-[#15211d]">{n8ResultSentence(input!, outcome.result)}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.9rem] sm:grid-cols-3">
                <div>
                  <dt className="text-[#59655f]">Late payments that count</dt>
                  <dd className="font-bold">{outcome.result.counted.length} of 3</dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Counts as given</dt>
                  <dd className="font-bold">{longDate(outcome.result.deemedServiceDate)}</dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Earliest end</dt>
                  <dd className="font-bold">{longDate(outcome.result.earliestTermination)}</dd>
                </div>
              </dl>
              {outcome.result.late.length > 0 && (
                <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-white p-3 text-[0.82rem] leading-relaxed text-[#384a42]">
                  {outcome.result.details}
                </pre>
              )}
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-1 text-[1.2rem] font-extrabold tracking-tight">2. Fill the Form N8</h2>
        <p className="mb-4 text-[0.9rem] text-[#59655f]">
          We fill the Landlord and Tenant Board&apos;s current N8 (2026/09) for persistent late rent, with the late payments listed. You sign it and give it to the
          tenant.
        </p>
        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="n8-landlord">
              Landlord name (as on the lease)
            </label>
            <input id="n8-landlord" className={field} value={landlord} onChange={(e) => setLandlord(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="n8-tenants">
              Tenant names (separate with commas)
            </label>
            <input id="n8-tenants" className={field} value={tenants} onChange={(e) => setTenants(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="n8-address">
              Rental unit address
            </label>
            <input id="n8-address" className={field} placeholder="12 Main St, Unit 3, Windsor, ON N8Y 3B4" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="n8-fn">
                Your first name
              </label>
              <input id="n8-fn" className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n8-ln">
                Your last name
              </label>
              <input id="n8-ln" className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n8-phone">
                Your phone
              </label>
              <input id="n8-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            className={`${button} ${canFill ? "bg-[#16756a] text-white hover:bg-[#125f56]" : "pointer-events-none bg-[#d9e1dc] text-[#7a867f]"}`}
            href={canFill && input ? `${N8_TOOL_PATH}/official?${n8Query(input)}` : undefined}
            aria-disabled={!canFill}
            target="_blank"
            rel="noopener"
          >
            Download the filled N8 (PDF)
          </a>
        </div>
        {!canFill && (
          <ul className="mt-2 grid gap-0.5 text-[0.82rem] text-[#59655f]">
            {result ? result.problems.map((p) => <li key={p.code}>{p.text}</li>) : <li>Finish step 1 to turn on the download.</li>}
          </ul>
        )}
        <p className="mt-3 text-[0.82rem] text-[#59655f]">
          Check every field before you serve it. Remove the landlord checklist page first. This tool is not legal advice.
        </p>

        <div className="mt-6 rounded-xl bg-[#15211d] p-4 text-white">
          <p className="text-[0.98rem] font-bold">Let the rent record count the late payments for you.</p>
          <p className="mt-1 text-[0.88rem] text-white/80">
            On the Growth plan, Vacantless counts late payments from the rent you record and fills the N8, along with the N4, N5, N12, L1 and other Board forms. Start
            free with one rental.
          </p>
          <Link href={N8_TOOL_SIGNUP_HREF} className={`${button} mt-3 bg-white text-[#15211d] hover:bg-[#edf5f0]`}>
            Start free
          </Link>
        </div>
      </section>
    </div>
  );
}
