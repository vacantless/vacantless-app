import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdminEmail, inviteStatusLabel, inviteSourceLabel } from "@/lib/provisioning";
import { listRecentInvites, adminEmails } from "@/lib/provisioning-server";
import { OnboardLandlordForm } from "./onboard-form";
import { HandoffLandlordForm } from "./handoff-form";
import { GuidelineForm } from "./guideline-form";
import { setOrgFeatureFlagAsAdmin } from "./actions";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import {
  SETTINGS_ORG_FEATURES,
  envMasterForFeature,
  featureFlagOverrideForOrg,
  isFeatureEnabledForOrg,
  loadOrganizationFeatureFlagsByOrg,
  planDefaultForFeature,
  type OrganizationFeatureFlag,
} from "@/lib/feature-entitlements";

export const dynamic = "force-dynamic";
// Service-role reads of org_invites must always see live rows.
export const fetchCache = "force-no-store";

type AdminSearchParams = {
  features?: string;
};

type AdminOrgRow = {
  id: string;
  name: string | null;
  slug: string | null;
  plan: string | null;
};

function featureFlash(status: string | undefined): {
  className: string;
  text: string;
} | null {
  switch (status) {
    case "saved":
      return {
        className: "border-green-200 bg-green-50 text-green-800",
        text: "Feature access saved.",
      };
    case "invalid":
      return {
        className: "border-red-200 bg-red-50 text-red-800",
        text: "Pick a valid organization, feature, and access setting.",
      };
    case "not_configured":
      return {
        className: "border-red-200 bg-red-50 text-red-800",
        text: "Service role is not configured, so client feature access cannot be saved.",
      };
    case "forbidden":
      return {
        className: "border-red-200 bg-red-50 text-red-800",
        text: "Not authorized to change client feature access.",
      };
    case "error":
      return {
        className: "border-red-200 bg-red-50 text-red-800",
        text: "Something went wrong saving feature access.",
      };
    default:
      return null;
  }
}

function featureModeButtonClass(active: boolean): string {
  return active
    ? "rounded-md border border-slate-900 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-100"
    : "rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-900";
}

// Superadmin-only operator console (S354). Dark by default: it 404s for anyone
// not on the PROVISIONING_ADMIN_EMAILS allowlist, so ordinary owners/operators
// never see it. Standing up a brand-new landlord org (operator concierge
// onboarding) is the scale version of the manual WORKFLOW 112 steps.
export default async function AdminConsolePage({
  searchParams = {},
}: {
  searchParams?: AdminSearchParams;
}) {
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
  const admin = createAdminClient();
  let featureAccessError: string | null = admin
    ? null
    : "Service role is not configured, so client feature access cannot be read.";
  let orgRows: AdminOrgRow[] = [];
  let featureFlagsByOrg = new Map<string, OrganizationFeatureFlag[]>();
  if (admin) {
    const { data: orgData, error: orgError } = await admin
      .from("organizations")
      .select("id, name, slug, plan")
      .order("name", { ascending: true })
      .limit(100);
    if (orgError) {
      featureAccessError = orgError.message;
    } else {
      orgRows = ((orgData ?? []) as AdminOrgRow[]).filter((org) => !!org.id);
      featureFlagsByOrg = await loadOrganizationFeatureFlagsByOrg(
        admin,
        orgRows.map((org) => org.id),
      );
    }
  }
  const featureFlashMessage = featureFlash(searchParams.features);

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
        <h2 className="text-sm font-semibold text-slate-700">Client feature access</h2>
        {featureFlashMessage && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${featureFlashMessage.className}`}>
            {featureFlashMessage.text}
          </div>
        )}
        {featureAccessError ? (
          <p className="text-sm text-red-600">{featureAccessError}</p>
        ) : orgRows.length === 0 ? (
          <p className="text-sm text-slate-400">No organizations found.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-[220rem] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 z-10 min-w-56 bg-slate-50 px-3 py-2 font-medium">
                    Organization
                  </th>
                  {SETTINGS_ORG_FEATURES.map((feature) => (
                    <th key={feature.key} className="min-w-40 px-3 py-2 font-medium">
                      <span className="block text-slate-700 normal-case">
                        {feature.label}
                      </span>
                      <span className="block font-mono normal-case text-slate-400">
                        {feature.key}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {orgRows.map((org) => {
                  const featureFlags = featureFlagsByOrg.get(org.id) ?? [];
                  return (
                    <tr key={org.id} className="align-top">
                      <th className="sticky left-0 z-10 bg-white px-3 py-3 font-medium text-slate-800">
                        <span className="block text-sm">{org.name ?? "Unnamed organization"}</span>
                        <span className="mt-0.5 block font-mono text-[11px] font-normal text-slate-400">
                          {org.slug ?? org.id}
                        </span>
                        <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          {org.plan ?? "trial"}
                        </span>
                      </th>
                      {SETTINGS_ORG_FEATURES.map((feature) => {
                        const orgForResolver = { ...org, featureFlags };
                        const override = featureFlagOverrideForOrg(
                          feature.key,
                          orgForResolver,
                        );
                        const effectiveEnabled = isFeatureEnabledForOrg(
                          feature.key,
                          orgForResolver,
                          { env: process.env },
                        );
                        const planDefault = planDefaultForFeature(feature.key, org.plan);
                        const envMaster = envMasterForFeature(feature.key);
                        const envEnabled = envMaster
                          ? envFlagEnabled(process.env[envMaster])
                          : null;
                        const mode =
                          override === null ? "default" : override ? "on" : "off";
                        return (
                          <td key={`${org.id}-${feature.key}`} className="px-3 py-3">
                            <form action={setOrgFeatureFlagAsAdmin} className="space-y-2">
                              <input type="hidden" name="organization_id" value={org.id} />
                              <input type="hidden" name="feature_key" value={feature.key} />
                              <div className="space-y-1">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                    effectiveEnabled
                                      ? "bg-green-50 text-green-700"
                                      : "bg-slate-100 text-slate-600"
                                  }`}
                                >
                                  {effectiveEnabled ? "On" : "Off"}
                                </span>
                                <p className="text-[11px] text-slate-500">
                                  Plan {planDefault ? "on" : "off"}
                                  {" / "}
                                  {override === null
                                    ? "default"
                                    : override
                                      ? "override on"
                                      : "override off"}
                                </p>
                                {envMaster && (
                                  <p className="font-mono text-[10px] text-slate-400">
                                    {envMaster}: {envEnabled ? "on" : "off"}
                                  </p>
                                )}
                              </div>
                              <div className="grid grid-cols-3 gap-1">
                                <button
                                  type="submit"
                                  name="mode"
                                  value="default"
                                  disabled={mode === "default"}
                                  className={featureModeButtonClass(mode === "default")}
                                >
                                  Plan
                                </button>
                                <button
                                  type="submit"
                                  name="mode"
                                  value="on"
                                  disabled={mode === "on"}
                                  className={featureModeButtonClass(mode === "on")}
                                >
                                  On
                                </button>
                                <button
                                  type="submit"
                                  name="mode"
                                  value="off"
                                  disabled={mode === "off"}
                                  className={featureModeButtonClass(mode === "off")}
                                >
                                  Off
                                </button>
                              </div>
                            </form>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

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
