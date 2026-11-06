"use client";

// S757: the free Ontario N12 filler. No sign-in. Dates and compensation compute
// in the browser with lib/n12-tool.ts; the download link calls a route that
// recomputes everything on the server from the same inputs.

import { useMemo, useState } from "react";
import Link from "next/link";
import { SERVICE_METHODS, centsToDollars, longDate, moneyToCents } from "@/lib/n4-tool";
import {
  N12_RELATIONSHIP_LABELS,
  N12_TOOL_PATH,
  N12_TOOL_SIGNUP_HREF,
  computeN12Tool,
  n12Query,
  n12ResultSentence,
  type N12ToolInput,
} from "@/lib/n12-tool";
import { N12_RELATIONSHIPS, type N12Reason, type N12Relationship, type N12ServiceMethod } from "@/lib/n12";

const field =
  "w-full rounded-lg border border-[#c9d4ce] bg-white px-3 py-2.5 text-[1rem] text-[#15211d] outline-none focus:border-[#16756a] focus:ring-2 focus:ring-[#16756a]/20";
const label = "mb-1 block text-[0.86rem] font-bold text-[#384a42]";
const button = "inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-[0.95rem] font-bold transition";

export function N12Tool({ today }: { today: string }) {
  const [reason, setReason] = useState<N12Reason>(1);
  const [person, setPerson] = useState("");
  const [relationship, setRelationship] = useState<N12Relationship>("self");
  const [care, setCare] = useState(false);
  const [individual, setIndividual] = useState(true);
  const [rent, setRent] = useState("");
  const [served, setServed] = useState(today);
  const [method, setMethod] = useState<N12ServiceMethod>("hand");
  const [term, setTerm] = useState("");
  const [end, setEnd] = useState("");
  const [landlord, setLandlord] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [tenants, setTenants] = useState("");
  const [address, setAddress] = useState("");

  const input: N12ToolInput | null = useMemo(() => {
    const rentCents = moneyToCents(rent);
    if (rentCents == null || !/^\d{4}-\d{2}-\d{2}$/.test(served)) return null;
    return {
      reason,
      personName: person.trim(),
      relationship,
      careProvider: care,
      rentCents,
      serviceDate: served,
      method,
      fixedTermEnd: /^\d{4}-\d{2}-\d{2}$/.test(term) ? term : null,
      terminationDate: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null,
      landlordName: landlord.trim(),
      landlordIsIndividual: individual,
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
  }, [reason, person, relationship, care, individual, rent, served, method, term, end, landlord, firstName, lastName, phone, tenants, address]);

  const outcome = useMemo(() => (input ? computeN12Tool(input, today) : null), [input, today]);
  const result = outcome && outcome.ok ? outcome.result : null;
  const canFill = !!(result && result.problems.length === 0);
  const dateProblems = result?.problems.filter((p) => ["too_soon", "not_period_end", "before_term_end", "bad_date"].includes(p.code)) ?? [];
  const otherProblems = result?.problems.filter((p) => !dateProblems.includes(p)) ?? [];
  const who = (r: N12Relationship) => N12_RELATIONSHIP_LABELS[r][reason === 1 ? "own" : "buyer"];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-[1.2rem] font-extrabold tracking-tight">1. Who needs the unit, and when</h2>
        <div className="grid gap-4">
          <fieldset>
            <legend className={label}>Why you are ending the tenancy</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { v: 1 as N12Reason, t: "I or my family will live there", d: "Own use (Reason 1)" },
                { v: 2 as N12Reason, t: "I sold it and the buyer will live there", d: "Purchaser (Reason 2)" },
              ].map((o) => (
                <label
                  key={o.v}
                  className={`cursor-pointer rounded-lg border p-3 ${reason === o.v ? "border-[#16756a] bg-[#edf5f0]" : "border-[#c9d4ce]"}`}
                >
                  <input type="radio" name="n12-reason" className="mr-2" checked={reason === o.v} onChange={() => setReason(o.v)} />
                  <span className="font-bold">{o.t}</span>
                  <span className="block pl-5 text-[0.82rem] text-[#59655f]">{o.d}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="n12-rel">
                Who will move in
              </label>
              <select id="n12-rel" className={field} value={relationship} onChange={(e) => setRelationship(e.target.value as N12Relationship)}>
                {N12_RELATIONSHIPS.map((r) => (
                  <option key={r} value={r}>
                    {who(r)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="n12-person">
                Their full name
              </label>
              <input id="n12-person" className={field} value={person} onChange={(e) => setPerson(e.target.value)} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-[0.9rem] text-[#384a42]">
            <input type="checkbox" className="mt-1" checked={care} onChange={(e) => setCare(e.target.checked)} />
            <span>The person moving in will provide care services to {reason === 1 ? "me or my family member" : "the buyer or their family member"}.</span>
          </label>
          {reason === 1 && (
            <label className="flex items-start gap-2 text-[0.9rem] text-[#384a42]">
              <input type="checkbox" className="mt-1" checked={individual} onChange={(e) => setIndividual(e.target.checked)} />
              <span>I am the landlord as a person, not a company. A company can&apos;t give an N12 for its own use.</span>
            </label>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="n12-rent">
                Monthly rent
              </label>
              <input id="n12-rent" className={field} inputMode="decimal" placeholder="1,500" value={rent} onChange={(e) => setRent(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n12-term">
                Fixed term ends (leave blank if month to month)
              </label>
              <input id="n12-term" className={field} type="date" value={term} onChange={(e) => setTerm(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="n12-served">
                Day you give the notice
              </label>
              <input id="n12-served" className={field} type="date" min={today} value={served} onChange={(e) => setServed(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n12-method">
                How you give it
              </label>
              <select id="n12-method" className={field} value={method} onChange={(e) => setMethod(e.target.value as N12ServiceMethod)}>
                {SERVICE_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[0.82rem] text-[#59655f]">{SERVICE_METHODS.find((m) => m.value === method)?.note}</p>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="n12-end">
              Termination date (blank = the earliest allowed)
            </label>
            <input id="n12-end" className={field} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-[#16756a]/30 bg-[#edf5f0] p-4">
          {!outcome ? (
            <p className="text-[0.95rem] text-[#384a42]">Enter the rent and the day you give the notice and the dates appear here.</p>
          ) : !outcome.ok ? (
            <p className="text-[0.95rem] font-bold text-[#8a4b00]">{outcome.error}</p>
          ) : dateProblems.length > 0 ? (
            <ul className="grid gap-1 text-[0.95rem] font-bold text-[#8a4b00]">
              {dateProblems.map((p) => (
                <li key={p.code}>{p.text}</li>
              ))}
              <li className="font-normal text-[#384a42]">The earliest valid date is {longDate(outcome.result.earliestTermination)}.</li>
            </ul>
          ) : (
            <>
              <p className="text-[1.05rem] font-bold leading-snug text-[#15211d]">{n12ResultSentence(input!, outcome.result)}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[0.9rem] sm:grid-cols-3">
                <div>
                  <dt className="text-[#59655f]">Counts as given</dt>
                  <dd className="font-bold">{longDate(outcome.result.deemedServiceDate)}</dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Earliest end</dt>
                  <dd className="font-bold">{longDate(outcome.result.earliestTermination)}</dd>
                </div>
                <div>
                  <dt className="text-[#59655f]">Compensation</dt>
                  <dd className="font-bold">
                    {outcome.result.compensationRequired
                      ? outcome.result.compensationCents != null
                        ? centsToDollars(outcome.result.compensationCents)
                        : "One month's rent"
                      : "None"}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[#d9e1dc] bg-white p-5 sm:p-6">
        <h2 className="mb-1 text-[1.2rem] font-extrabold tracking-tight">2. Fill the Form N12</h2>
        <p className="mb-4 text-[0.9rem] text-[#59655f]">
          We fill the Landlord and Tenant Board&apos;s current N12 (2026/10) with your answers. You sign it and give it to the tenant.
        </p>
        <div className="grid gap-4">
          <div>
            <label className={label} htmlFor="n12-landlord">
              Landlord name (as on the lease)
            </label>
            <input id="n12-landlord" className={field} value={landlord} onChange={(e) => setLandlord(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="n12-tenants">
              Tenant names (separate with commas)
            </label>
            <input id="n12-tenants" className={field} value={tenants} onChange={(e) => setTenants(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="n12-address">
              Rental unit address
            </label>
            <input
              id="n12-address"
              className={field}
              placeholder="12 Main St, Unit 3, Windsor, ON N8Y 3B4"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="n12-fn">
                Your first name
              </label>
              <input id="n12-fn" className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n12-ln">
                Your last name
              </label>
              <input id="n12-ln" className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="n12-phone">
                Your phone
              </label>
              <input id="n12-phone" className={field} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <a
            className={`${button} ${canFill ? "bg-[#16756a] text-white hover:bg-[#125f56]" : "pointer-events-none bg-[#d9e1dc] text-[#7a867f]"}`}
            href={canFill && input ? `${N12_TOOL_PATH}/official?${n12Query(input)}` : undefined}
            aria-disabled={!canFill}
            target="_blank"
            rel="noopener"
          >
            Download the filled N12 (PDF)
          </a>
        </div>
        {!canFill && (
          <ul className="mt-2 grid gap-0.5 text-[0.82rem] text-[#59655f]">
            {result ? (
              (dateProblems.length ? dateProblems : otherProblems).map((p) => <li key={p.code}>{p.text}</li>)
            ) : (
              <li>Finish step 1 to turn on the download.</li>
            )}
          </ul>
        )}
        <p className="mt-3 text-[0.82rem] text-[#59655f]">
          Check every field before you serve it. Remove the landlord checklist pages first. This tool is not legal advice.
        </p>

        <div className="mt-6 rounded-xl bg-[#15211d] p-4 text-white">
          <p className="text-[0.98rem] font-bold">Keep the tenancy and the paperwork in one place.</p>
          <p className="mt-1 text-[0.88rem] text-white/80">
            On the Growth plan, Vacantless fills the N12 from the tenancy, along with the N4, N5, N8, L1 and other Board forms. Start free with one rental.
          </p>
          <Link href={N12_TOOL_SIGNUP_HREF} className={`${button} mt-3 bg-white text-[#15211d] hover:bg-[#edf5f0]`}>
            Start free
          </Link>
        </div>
      </section>
    </div>
  );
}
