import type { SupabaseClient } from "@supabase/supabase-js";
import { SITE_SIGNIN_LABEL } from "@/lib/site-signin";
import { SIGNIN_RECORDING_STARTED, lifetimeLabel, signinLifetimes, type SigninEvent } from "@/lib/signin-lifetime";

// S838 (REVIEW-S837 1.2a): how long robot-site sign-ins last, all accounts.
export async function SigninLifetimeSection({ admin }: { admin: SupabaseClient | null }) {
  if (!admin) return null;
  const { data, error } = await admin
    .from("site_signin_events")
    .select("organization_id, channel, event, at")
    .order("at", { ascending: true })
    .limit(20_000);
  const rows = signinLifetimes((data ?? []) as SigninEvent[]);
  const label = (c: string) => (SITE_SIGNIN_LABEL as Record<string, string>)[c] ?? c;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-700">How long site sign-ins last</h2>
      <p className="text-xs text-slate-500">
        From each sign-in to the site signing the account out. Recording started {SIGNIN_RECORDING_STARTED}.
      </p>
      {error && <p className="text-xs text-red-700">Could not read the sign-ins: {error.message}</p>}
      {!error && rows.length === 0 && <p className="text-xs text-slate-500">No sign-in or sign-out recorded yet.</p>}
      {rows.length > 0 && (
        <table className="w-full max-w-xl text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="py-1 font-medium">Site</th>
              <th className="py-1 text-right font-medium">Ended</th>
              <th className="py-1 text-right font-medium">Typical</th>
              <th className="py-1 text-right font-medium">Shortest</th>
              <th className="py-1 text-right font-medium">Longest</th>
              <th className="py-1 text-right font-medium">Signed in now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel} className="border-t border-slate-100">
                <td className="py-1">{label(r.channel)}</td>
                <td className="py-1 text-right">{r.ended}</td>
                <td className="py-1 text-right">{lifetimeLabel(r.medianHours)}</td>
                <td className="py-1 text-right">{lifetimeLabel(r.shortestHours)}</td>
                <td className="py-1 text-right">{lifetimeLabel(r.longestHours)}</td>
                <td className="py-1 text-right">{r.signedInNow}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
