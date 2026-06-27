import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { shapeReferralRows, referralCounts, type ReferralRow } from "@/lib/referrals";
import { ReferAFriendForm } from "./refer-form";

export const dynamic = "force-dynamic";

// "Refer a landlord" surface (Slice 2). A referral is a cold homepage signup
// with attribution: the landlord generates a link that drops a friend into the
// normal /signup flow (the friend self-creates their own account), and we record
// who referred them. Rows are read via the AUTHED client; RLS policy
// org_invites_select_own scopes them to referred_by_org_id in the caller's orgs,
// so a landlord only ever sees their OWN referrals.
//
// Ships dark: this page is not linked in the nav unless REFERRALS_ENABLED=1
// (gated in the dashboard layout). It stays reachable by direct URL for QA.
export default async function ReferralsPage() {
  const supabase = createClient();
  const org = await getCurrentOrg();

  const { data } = await supabase
    .from("org_invites")
    .select("id, created_at, invited_email, invited_name, status, token, accepted_at")
    .eq("source", "referral")
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = (data as ReferralRow[] | null) ?? [];
  const views = shapeReferralRows(rows);
  const counts = referralCounts(rows);

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900">Refer a landlord</h1>
        <p className="text-sm text-slate-500">
          Know another landlord who could use Vacantless? Send them a link and
          they&rsquo;ll set up their own free account in a couple of minutes.
        </p>
      </header>

      <ReferAFriendForm />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Your referrals</h2>
          {counts.total > 0 && (
            <p className="text-xs text-slate-500">
              {counts.joined} joined · {counts.pending} invited
            </p>
          )}
        </div>

        {views.length === 0 ? (
          <p className="text-sm text-slate-400">
            No referrals yet. Generate a link above to invite your first landlord.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Landlord</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Invited</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {views.map((v) => (
                  <tr key={v.id}>
                    <td className="px-3 py-2 text-slate-800">{v.label}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          v.isAccepted
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {v.statusLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(v.createdAt).toLocaleDateString("en-CA")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!org && (
        <p className="text-xs text-slate-400">
          Sign in with your landlord account to generate referral links.
        </p>
      )}
    </div>
  );
}
