"use client";

import { useMemo, useState } from "react";
import { parseBulkRentals, summarizeBulkRentals } from "@/lib/bulk-rentals";
import { importRentals } from "./actions";

const SAMPLE = [
  "Address\tUnit\tRent\tBeds\tBaths\tTenant\tEmail\tLease from\tLease to",
  "12 King St\t1\t1450\t2\t1\tAva Lee\tava@example.com\t2026-02-01\t2027-01-31",
  "12 King St\t2\t1200\t1\t1\t\t\t\t",
].join("\n");

function money(cents: number | null): string {
  if (cents == null) return "";
  return `$${(cents / 100).toLocaleString("en-CA", { maximumFractionDigits: 2 })}`;
}

export function BulkImportForm({ existingAddresses }: { existingAddresses: string[] }) {
  const [text, setText] = useState("");
  const [fileNote, setFileNote] = useState("");
  const result = useMemo(() => parseBulkRentals(text, { existingAddresses }), [text, existingAddresses]);
  const sum = useMemo(() => summarizeBulkRentals(result.rows), [result]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setFileNote("That file is not a CSV. In Excel or Google Sheets, save the sheet as CSV first.");
      return;
    }
    setFileNote("");
    setText(await file.text());
  }

  return (
    <form action={importRentals} className="space-y-5">
      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">1. Paste your rentals</h2>
        <p className="mt-1 text-sm text-gray-600">
          Copy the rows from Excel or Google Sheets and paste them here. Keep the header row. Only the address is needed.
        </p>
        <textarea
          name="rows_text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          aria-label="Rows copied from your spreadsheet"
          placeholder={SAMPLE}
          className="mt-3 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-gray-700">
          <label className="cursor-pointer rounded-lg border border-gray-300 px-3 py-1.5 font-medium hover:bg-gray-50">
            Or choose a CSV file
            <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} className="sr-only" />
          </label>
          <button
            type="button"
            onClick={() => setText(SAMPLE)}
            className="text-sm font-medium text-gray-600 underline hover:text-gray-900"
          >
            Show me an example
          </button>
        </div>
        {fileNote && <p className="mt-2 text-sm text-amber-800">{fileNote}</p>}
        <p className="mt-3 text-xs text-gray-500">
          We read these columns: Address, Unit, City, Rent, Beds, Baths. Also Tenant, Email, Phone, Lease from, Lease to.
        </p>
      </div>

      {result.rows.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-900">2. Check what we read</h2>
          <p className="mt-1 text-sm text-gray-600">
            {sum.ready} to save{sum.skipped > 0 ? `, ${sum.skipped} left out` : ""}.{" "}
            {sum.withTenancy > 0 ? `${sum.withTenancy} with a tenant. ` : ""}
            {sum.drafts > 0 ? `${sum.drafts} as private drafts. ` : ""}
            All of them stay private until you set one live.
          </p>
          {!result.hadHeader && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              We found no header row. We read the columns as Address, Rent, Beds, Baths. Add a header row if yours differ.
            </p>
          )}
          {result.unreadColumns.length > 0 && (
            <p className="mt-2 text-xs text-gray-500">Columns we did not use: {result.unreadColumns.join(", ")}.</p>
          )}
          {result.tooMany && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              We read the first 200 rows. Save these, then paste the rest.
            </p>
          )}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Address</th>
                  <th className="py-2 pr-3 font-medium">Rent</th>
                  <th className="py-2 pr-3 font-medium">Beds</th>
                  <th className="py-2 pr-3 font-medium">Baths</th>
                  <th className="py-2 pr-3 font-medium">Tenant</th>
                  <th className="py-2 pr-3 font-medium">Lease</th>
                  <th className="py-2 font-medium">Saved as</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => {
                  const bad = r.problems.length > 0;
                  return (
                    <tr key={r.line} className={`border-t border-gray-100 align-top ${bad ? "bg-red-50/60 text-gray-500" : ""}`}>
                      <td className="py-2 pr-3">
                        {r.address ?? <span className="italic">Row {r.line}</span>}
                        {r.notes.map((n) => (
                          <span key={n} className="block text-xs text-amber-800">{n}</span>
                        ))}
                      </td>
                      <td className="py-2 pr-3">{money(r.rentCents)}</td>
                      <td className="py-2 pr-3">{r.beds ?? ""}</td>
                      <td className="py-2 pr-3">{r.baths ?? ""}</td>
                      <td className="py-2 pr-3">{r.tenantName ?? ""}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {r.leaseStart ?? ""}
                        {r.leaseEnd ? ` to ${r.leaseEnd}` : ""}
                      </td>
                      <td className="py-2">
                        {bad ? (
                          <span className="font-medium text-red-700">Left out: {r.problems.join(". ")}</span>
                        ) : r.tenantName ? (
                          r.leaseStart ? "Rented, with tenant" : "Rented"
                        ) : (
                          "Draft"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={sum.ready === 0}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              {sum.ready === 1 ? "Save 1 rental" : `Save ${sum.ready} rentals`}
            </button>
            <span className="text-xs text-gray-500">Rent collection stays off. You turn it on for each tenant.</span>
          </div>
        </div>
      )}
    </form>
  );
}
