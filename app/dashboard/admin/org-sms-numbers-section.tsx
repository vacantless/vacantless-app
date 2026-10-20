import { createAdminClient } from "@/lib/supabase/admin";
import { setOrgSmsNumberAsAdmin } from "./actions";

// S717: each landlord's own texting number (staff only, migration 0248).
// A number that is on sends that landlord's renter texts and receives their
// replies. Buy the number in Twilio first, and point its incoming text and
// call webhooks at /api/sms/inbound and /api/sms/voice before turning it on.
export async function OrgSmsNumbersSection({ flash }: { flash?: string }) {
  const admin = createAdminClient();
  if (!admin) return null;
  const [{ data: orgs }, rowsRes] = await Promise.all([
    admin.from("organizations").select("id, name, sms_requested_at").is("closed_at", null).order("name"),
    admin.from("org_sms_numbers").select("organization_id, phone_e164, enabled"),
  ]);
  const tableReady = !rowsRes.error;
  const byOrg = new Map(
    ((rowsRes.data ?? []) as { organization_id: string; phone_e164: string; enabled: boolean }[]).map(
      (r) => [r.organization_id, r],
    ),
  );
  const message =
    flash === "saved"
      ? "Number saved."
      : flash === "bad_number"
        ? "That is not a Canadian number. Use a format like 226 555 0123."
        : flash === "taken"
          ? "That number already belongs to another account."
          : flash === "forbidden"
            ? "Not authorized."
            : flash === "invalid"
              ? "Pick an account."
              : flash === "error"
                ? "Could not save the number."
                : null;

  return (
    <section id="texting-numbers" className="scroll-mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Texting numbers</h2>
      <p className="text-xs text-slate-500">
        A landlord with a number that is on texts renters from it and gets their replies. Texts go to
        Canadian phones only. Turn a number on after its incoming text and call webhooks are set in Twilio.
      </p>
      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">{message}</div>
      )}
      {!tableReady && (
        <p className="text-sm text-amber-700">
          The texting numbers table is not in the database yet (migration 0248).
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Number and status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {(
              (orgs ?? []) as { id: string; name: string | null; sms_requested_at?: string | null }[]
            )
              // S726f: accounts that asked for texting and have no number yet go first.
              .sort((a, b) => Number(!!b.sms_requested_at && !byOrg.has(b.id)) - Number(!!a.sms_requested_at && !byOrg.has(a.id)))
              .map((o) => {
              const row = byOrg.get(o.id);
              const waiting = !!o.sms_requested_at && !row;
              return (
                <tr key={o.id} className={waiting ? "bg-amber-50" : undefined}>
                  <th className="px-3 py-2 font-medium text-slate-800">
                    {o.name ?? o.id}
                    {waiting && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                        Asked {new Date(o.sms_requested_at as string).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" })}
                      </span>
                    )}
                  </th>
                  <td className="px-3 py-2">
                    <form action={setOrgSmsNumberAsAdmin} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="organization_id" value={o.id} />
                      <input
                        name="phone"
                        defaultValue={row?.phone_e164 ?? ""}
                        placeholder="+12265550123"
                        className="w-36 rounded border border-slate-300 px-2 py-0.5"
                      />
                      <label className="flex items-center gap-1">
                        <input type="checkbox" name="enabled" defaultChecked={row?.enabled === true} />
                        On
                      </label>
                      <button
                        type="submit"
                        name="mode"
                        value="save"
                        disabled={!tableReady}
                        className="rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                      >
                        Save
                      </button>
                      {row && (
                        <button
                          type="submit"
                          name="mode"
                          value="remove"
                          className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-red-700 hover:bg-slate-50"
                        >
                          Remove
                        </button>
                      )}
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
