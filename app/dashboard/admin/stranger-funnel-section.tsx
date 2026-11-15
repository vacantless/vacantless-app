import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOutsideAccounts } from "@/lib/account-counts-server";
import { FUNNEL_DAYS, biggestDrop, buildFunnel, distinctVisitors } from "@/lib/stranger-funnel";

// S800 (REVIEW-S799 item 8): the stranger's path, last 30 days, for the admin
// console. Our own test accounts are left out the same way as the daily email.
export async function StrangerFunnelSection({ admin }: { admin: SupabaseClient | null }) {
  if (!admin) return null;
  const since = new Date(Date.now() - FUNNEL_DAYS * 86_400_000);
  const sinceDay = since.toISOString().slice(0, 10);
  const [{ accounts, error }, { data: visits, error: visitError }] = await Promise.all([
    loadOutsideAccounts(admin, since.toISOString()),
    admin.from("funnel_visits").select("visitor, page").gte("visited_on", sinceDay).limit(50_000),
  ]);
  const rows = (visits ?? []) as { visitor: string; page: string }[];
  const steps = buildFunnel({
    homeVisitors: distinctVisitors(rows, "home"),
    signupVisitors: distinctVisitors(rows, "signup"),
    accounts,
  });
  const drop = biggestDrop(steps);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">Stranger path, last {FUNNEL_DAYS} days</h2>
      <p className="text-xs text-slate-500">
        People and accounts that are not ours. Visits count each browser once, and only when not signed in.
        Visit counting started Nov 15, 2026.
      </p>
      {(error || visitError) && (
        <p className="text-xs text-red-700">Could not read every number: {error ?? visitError?.message}</p>
      )}
      <table className="w-full max-w-xl text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 font-medium">Step</th>
            <th className="py-1 text-right font-medium">Count</th>
            <th className="py-1 text-right font-medium">Kept from the step above</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((s) => (
            <tr key={s.label} className="border-t border-slate-100">
              <td className="py-1.5 text-slate-800">{s.label}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums text-slate-900">{s.count}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-600">
                {s.keptPct == null ? "" : `${s.keptPct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {drop && <p className="text-xs text-slate-600">{drop}</p>}
    </section>
  );
}
