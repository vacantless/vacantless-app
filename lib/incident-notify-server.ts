// Moved from app/report/[token]/actions.ts in S808b so a texted repair request
// (lib/text-in-repairs) sends the same emails as the web form. Server only: it
// reads member emails with the service key. Not a server action on purpose.
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveIncidentNotifyEmails,
  incidentCategoryLabel,
  isMessageCategory,
  type NotifyMember,
} from "@/lib/incident-reports";
import {
  isFeatureEnabledForOrg,
  loadOrganizationFeatureFlags,
} from "@/lib/feature-entitlements";
import { sendIncidentReportNotification } from "@/lib/email";
import { emergencyAlertText, emergencyTextTarget, type EmergencyKind } from "@/lib/tenant-emergency";
import { normalizePhoneE164, sendSms } from "@/lib/sms";
import { orgOwnSmsNumber } from "@/lib/org-sms-numbers";
import { canUseRenterSms } from "@/lib/billing";

// Notify everyone on the org who can triage maintenance that a new report landed.
// The tenant is account-less (anon), so this uses the SERVICE-ROLE admin client
// to read the org, the report, and the membership emails RLS hides from anon.
// Recipients derive from org membership + manage_work_orders (NOT a subscription
// table). Caps the fan-out defensively. S776: an emergency also texts the
// account's Emergency phone (lib/tenant-emergency emergencyTextTarget) from the
// account's texting number, at any hour.
const MAX_NOTIFY_RECIPIENTS = 10;

export async function notifyOperatorsOfNewReport(
  organizationId: string,
  reportId: string,
  emergencyKind: EmergencyKind | null,
): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return; // no service key -> can't read members; skip quietly

  // Org branding + fallback addresses + plan gate.
  const { data: org } = await admin
    .from("organizations")
    .select(
      "id, name, brand_color, logo_url, mail_alias, reply_to_email, public_contact_email, plan, emergency_phone, showing_arrival_phone, public_contact_phone",
    )
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return;
  // Defensive: only notify when the org actually has the intake feature (the link
  // could only have been generated while entitled, but re-check anyway).
  const featureFlags = await loadOrganizationFeatureFlags(admin, organizationId, [
    "incident_intake",
  ]);
  if (
    !isFeatureEnabledForOrg(
      "incident_intake",
      { ...org, featureFlags },
      { env: process.env },
    )
  ) {
    return;
  }

  // The report + its unit address (for the email subject/body).
  const { data: report } = await admin
    .from("incident_reports")
    .select(
      "category, description, reporter_name, reporter_contact, property:properties(address, emergency_phone)",
    )
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return;
  const r = report as unknown as {
    category: string;
    description: string;
    reporter_name: string | null;
    reporter_contact: string | null;
    property: { address: string; emergency_phone?: string | null } | null;
  };

  // S776: the emergency text goes first; it does not wait on the emails.
  const textSent = emergencyKind
    ? textEmergency(admin, org, emergencyKind, r).catch(() => undefined)
    : Promise.resolve(undefined);

  // Members of the org -> resolve each one's auth email.
  const { data: memberRows } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId);
  const members: NotifyMember[] = [];
  for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
    const { data: u } = await admin.auth.admin.getUserById(m.user_id);
    members.push({ role: m.role, email: u?.user?.email ?? null });
  }

  const recipients = resolveIncidentNotifyEmails(members, [
    org.reply_to_email,
    org.public_contact_email,
  ]).slice(0, MAX_NOTIFY_RECIPIENTS);
  if (recipients.length === 0) return;

  await Promise.allSettled(
    recipients.map((to) =>
      sendIncidentReportNotification({
        to_email: to,
        org_name: org.name ?? null,
        brand_color: org.brand_color ?? null,
        logo_url: org.logo_url ?? null,
        property_address: r.property?.address ?? null,
        category_label: incidentCategoryLabel(r.category),
        description: r.description,
        reporter_name: r.reporter_name,
        emergency_kind: emergencyKind,
        is_message: isMessageCategory(r.category),
      }),
    ),
  );
  await textSent;
}

// S776: text the landlord about an emergency from the account's texting number.
// Needs a plan with texts and a number that can take one; otherwise the email
// above is the alert. sendSms applies the live switch and the monthly limit.
async function textEmergency(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  org: {
    id: string;
    plan?: string | null;
    emergency_phone?: string | null;
    showing_arrival_phone?: string | null;
    public_contact_phone?: string | null;
  },
  kind: EmergencyKind,
  r: {
    reporter_name: string | null;
    reporter_contact: string | null;
    property: { address: string; emergency_phone?: string | null } | null;
  },
): Promise<void> {
  if (!canUseRenterSms(org.plan ?? null)) return;
  const own = await orgOwnSmsNumber(admin, org.id).catch(() => null);
  const to = emergencyTextTarget(
    { ...org, rental_emergency_phone: r.property?.emergency_phone ?? null },
    own,
    normalizePhoneE164,
  );
  if (!to) return;
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/$/, "");
  await sendSms({
    to,
    organizationId: org.id,
    body: emergencyAlertText({
      kind,
      address: r.property?.address ?? null,
      reporterName: r.reporter_name,
      reporterContact: r.reporter_contact,
      inboxUrl: `${base}/dashboard/maintenance#reports`,
    }),
  });
}
