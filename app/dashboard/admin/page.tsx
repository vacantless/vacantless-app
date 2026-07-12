import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail, inviteStatusLabel, inviteSourceLabel } from "@/lib/provisioning";
import { listRecentInvites, adminEmails } from "@/lib/provisioning-server";
import { OnboardLandlordForm } from "./onboard-form";
import { HandoffLandlordForm } from "./handoff-form";
import { GuidelineForm } from "./guideline-form";

export const dynamic = "force-dynamic";
// Service-role reads of org_invites must always see live rows.
export const fetchCache = "force-no-store";

// Superadmin-only operator console (S354). Dark by default: it 404s for anyone
// not on the PROVISIONING_ADMIN_EMAILS allowlist, so ordinary owners/operators
// never see it. Standing up a brand-new landlord org (operator concierge
// onboarding) is the scale version of the manual WORKFLOW 112 steps.
export default async function AdminConsolePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Hard gate: behave as if the route doesn't exist for non-admins.
  if (!isAdminEmail(user?.email, adminEmails())) notFound();

  const invites = await listRecentInvites(30);
  const { data: guidelineRows } = await supabase
    .from("rent_guidelines")
    .select("year, percent, source, updated_at")
    .order("year", { ascending: false });

  return (
    <div className="mx-auto max-w-6xl space-y-8 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900">Onboard a landlord</h1>
        <p className="text-sm text-slate-500">
          Stand up a proxy-safe landlord account, prepare it, then move the
          login and renter-facing contact to the real landlord at handoff.
          Operator-only.
        </p>
        <a
          href="/dashboard/admin/concierge"
          className="inline-block text-sm font-medium text-slate-700 underline hover:text-slate-900"
        >
          Publish-for-me desk →
        </a>
      </header>

      <OnboardLandlordForm />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Recent provisioning</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-slate-400">No accounts provisioned yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Login</th>
                  <th className="px-3 py-2 font-medium">Handoff</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invites.map((inv) => {
                  const canHandOff =
                    inv.status === "provisioned" &&
                    !!inv.provisioned_org_id &&
                    !!inv.provisioned_user_id &&
                    !!inv.intended_owner_email;
                  return (
                    <tr key={inv.id} className="align-top">
                      <td className="px-3 py-2 text-slate-800">{inv.invited_email ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {inv.handed_off_to_email ?? inv.intended_owner_email ?? "—"}
                        {inv.handed_off_at && (
                          <span className="block text-xs text-green-700">
                            handed off {new Date(inv.handed_off_at).toLocaleDateString("en-CA")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">{inv.invited_name ?? "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{inviteStatusLabel(inv.status)}</td>
                      <td className="px-3 py-2 text-slate-600">{inviteSourceLabel(inv.source)}</td>
                      <td className="min-w-48 px-3 py-2 text-slate-600">
                        <HandoffLandlordForm
                          inviteId={inv.id}
                          intendedOwnerEmail={inv.intended_owner_email}
                          disabled={!canHandOff}
                        />
                        {!canHandOff && inv.status === "provisioned" && (
                          <span className="text-xs text-slate-400">No handoff target</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {new Date(inv.created_at).toLocaleDateString("en-CA")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">Rent-increase guideline (Ontario)</h2>
        <p className="text-sm text-slate-500">
          The guideline % by the year an increase takes effect. Add next year&apos;s
          value when Ontario publishes it (usually late summer) &mdash; no redeploy
          needed. A year not listed here falls back to the shipped code default.
        </p>
        <GuidelineForm />
        {((guidelineRows ?? []) as Array<{ year: number; percent: number | string; source: string | null; updated_at: string }>).length > 0 && (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 font-medium">Guideline</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {((guidelineRows ?? []) as Array<{ year: number; percent: number | string; source: string | null; updated_at: string }>).map((g) => (
                  <tr key={g.year}>
                    <td className="px-3 py-2 text-slate-800">{g.year}</td>
                    <td className="px-3 py-2 text-slate-600">{g.percent}%</td>
                    <td className="px-3 py-2 text-slate-500">{g.source ?? "\u2014"}</td>
                    <td className="px-3 py-2 text-slate-500">{new Date(g.updated_at).toLocaleDateString("en-CA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
