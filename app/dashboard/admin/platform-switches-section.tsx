import { createAdminClient } from "@/lib/supabase/admin";
import {
  PLATFORM_SWITCHES,
  PLATFORM_SWITCH_KEYS,
  builtInSwitchOn,
} from "@/lib/platform-switches";
import { setPlatformSwitchAsAdmin } from "./actions";

// S717: staff-only per-account switches. Landlords never see or write these.
export async function PlatformSwitchesSection({ flash }: { flash?: string }) {
  const admin = createAdminClient();
  if (!admin) return null;
  const [{ data: orgs }, rowsRes] = await Promise.all([
    admin.from("organizations").select("id, name").is("closed_at", null).order("name"),
    admin.from("platform_org_switches").select("organization_id, switch_key, enabled"),
  ]);
  const tableReady = !rowsRes.error;
  const on = new Set(
    ((rowsRes.data ?? []) as { organization_id: string; switch_key: string; enabled: boolean }[])
      .filter((r) => r.enabled)
      .map((r) => `${r.organization_id}:${r.switch_key}`),
  );
  const message =
    flash === "saved"
      ? "Switch saved."
      : flash === "forbidden"
        ? "Not authorized."
        : flash === "invalid"
          ? "Pick an account and a switch."
          : flash === "error" || flash === "not_configured"
            ? "Could not save the switch."
            : null;

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Staff switches</h2>
      <p className="text-xs text-slate-500">
        Turned on here, never by the landlord. Built in means the code turns it on for that account.
      </p>
      {message && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">{message}</div>
      )}
      {!tableReady && (
        <p className="text-sm text-amber-700">
          The switches table is not in the database yet (migration 0247). Built-in accounts still work.
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              {PLATFORM_SWITCH_KEYS.map((k) => (
                <th key={k} className="px-3 py-2 font-medium normal-case text-slate-700" title={PLATFORM_SWITCHES[k].description}>
                  {PLATFORM_SWITCHES[k].label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {((orgs ?? []) as { id: string; name: string | null }[]).map((o) => (
              <tr key={o.id}>
                <th className="px-3 py-2 font-medium text-slate-800">{o.name ?? o.id}</th>
                {PLATFORM_SWITCH_KEYS.map((k) => {
                  const builtIn = builtInSwitchOn(k, o.id);
                  const isOn = builtIn || on.has(`${o.id}:${k}`);
                  return (
                    <td key={k} className="px-3 py-2">
                      {builtIn ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">On (built in)</span>
                      ) : (
                        <form action={setPlatformSwitchAsAdmin} className="flex items-center gap-2">
                          <input type="hidden" name="organization_id" value={o.id} />
                          <input type="hidden" name="switch_key" value={k} />
                          <span className={isOn ? "text-green-700" : "text-slate-500"}>{isOn ? "On" : "Off"}</span>
                          <button
                            type="submit"
                            name="mode"
                            value={isOn ? "off" : "on"}
                            disabled={!tableReady}
                            className="rounded border border-slate-300 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-50"
                          >
                            Turn {isOn ? "off" : "on"}
                          </button>
                        </form>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
