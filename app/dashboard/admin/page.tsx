import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail, inviteStatusLabel, inviteSourceLabel } from "@/lib/provisioning";
import { listRecentInvites, adminEmails } from "@/lib/provisioning-server";
import { OnboardLandlordForm } from "./onboard-form";

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

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-slate-900">Onboard a landlord</h1>
        <p className="text-sm text-slate-500">
          Stand up a new landlord with their own account and organization, then
          hand them the set-password link. Operator-only.
        </p>
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
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invites.map((inv) => (
                  <tr key={inv.id}>
                    <td className="px-3 py-2 text-slate-800">{inv.invited_email}</td>
                    <td className="px-3 py-2 text-slate-600">{inv.invited_name ?? "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{inviteStatusLabel(inv.status)}</td>
                    <td className="px-3 py-2 text-slate-600">{inviteSourceLabel(inv.source)}</td>
                    <td className="px-3 py-2 text-slate-500">
                      {new Date(inv.created_at).toLocaleDateString("en-CA")}
                    </td>
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
