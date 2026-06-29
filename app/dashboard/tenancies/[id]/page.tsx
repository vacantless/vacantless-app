import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  TENANCY_STATUSES,
  tenancyStatusLabel,
  tenancyErrorMessage,
  formatRentCents,
  MAX_TENANTS_PER_TENANCY,
} from "@/lib/tenancy";
import {
  PageHeader,
  StatusChip,
  tenancyStatusTone,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { CollapsibleSection } from "@/components/collapsible-section";
import {
  updateTenancy,
  endTenancy,
  deleteTenancy,
  addTenant,
  removeTenant,
  makePrimaryTenant,
  recordRentIncrease,
} from "../actions";
import { createRotessaCustomer, createRotessaSchedule } from "../rotessa-actions";
import { defaultFirstProcessDate, minProcessDate, formatProcessDate } from "@/lib/rotessa";
import TenancyStripeRentSection, {
  type TenancyStripeRentView,
} from "@/components/tenancy-stripe-rent-section";
import { getStripe } from "@/lib/stripe";
import { recordPayment, deletePayment } from "../payment-actions";
import { reportTenancyIssue, generateTenantReportLink } from "../maintenance-actions";
import { CopyLinkButton } from "@/components/copy-link-button";
import { tenantReportPath } from "@/lib/incident-reports";
import { sendTenantMessage } from "../comms-actions";
import {
  WORK_ORDER_CATEGORIES,
  WORK_ORDER_PRIORITIES,
  workOrderCategoryLabel,
  workOrderPriorityLabel,
  workOrderStatusLabel,
  workOrderStatusTone,
  workOrderPriorityTone,
  workOrderErrorMessage,
  isActiveStatus,
  maintenanceTemplateNameForStatus,
  statusOffersTenantUpdate,
  findTemplateIdByName,
  tenantScheduleDetails,
} from "@/lib/work-orders";
import {
  PAYMENT_METHODS,
  paymentMethodLabel,
  paymentErrorMessage,
  formatMoneyCents,
  formatPeriodMonth,
  reconcilePayments,
  type PaymentRow,
} from "@/lib/payments";
import { channelLabel, commsErrorMessage } from "@/lib/tenant-comms";
import { getCurrentOrg } from "@/lib/org";
import { canUseSms } from "@/lib/billing";
import TenantMessageComposer, {
  type ComposerTenant,
  type ComposerTemplate,
} from "@/components/tenant-message-composer";
import {
  TenancyLeaseSection,
  type LeaseDocView,
  type LeaseSignerView,
} from "@/components/tenancy-lease-section";
import type {
  WizardClause,
  LeaseSeedInfo,
} from "@/components/lease-clause-wizard";
import {
  resolveCurrentClauses,
  buildLeaseVars,
  seedSelectionFromSnapshot,
  type ExecutedClauseRef,
  type ClauseRowLike,
  type ClauseVersionRowLike,
  type RiskLevel,
} from "@/lib/clauses";
import { deriveRentIncrease } from "@/lib/rent-increase";
import { RentIncreaseCard } from "@/components/rent-increase-card";
import {
  pickDefaultOpenSection,
  type LeaseDocStatusLabel,
  type RentCollectionStatusLabel,
} from "@/lib/tenancy-section";
import {
  TenancyDocumentsSection,
  type DocumentView,
  type DocumentTenantOption,
  type InAppLeaseView,
} from "./documents-section";
import { createDocumentDownloadUrls } from "@/lib/documents-server";
import {
  TenancyInsuranceSection,
  type InsuranceView,
} from "./insurance-section";
import { insuranceStatusFor } from "@/lib/tenancy-insurance";
import {
  shareLinkStatus,
  executedLeaseVaultEntries,
  partitionVaultDocuments,
} from "@/lib/documents";
import { personDisplayName } from "@/lib/persons";

export const dynamic = "force-dynamic";

type Tenant = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  sms_opt_out: boolean;
};
type Tenancy = {
  id: string;
  status: string;
  rent_cents: number | null;
  deposit_cents: number | null;
  start_date: string;
  end_date: string | null;
  term_months: number | null;
  last_rent_increase_date: string | null;
  payment_notes: string | null;
  move_in_notes: string | null;
  notes: string | null;
  lead_id: string | null;
  rotessa_customer_id: string | null;
  rotessa_customer_synced_at: string | null;
  rotessa_schedule_id: string | null;
  rotessa_schedule_synced_at: string | null;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  stripe_mandate_status: string | null;
  stripe_rent_synced_at: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  report_token: string | null;
  property: {
    id: string;
    address: string;
    rent_control_exempt: boolean | null;
    first_occupancy_date: string | null;
  } | null;
  tenants: Tenant[];
};

type Payment = {
  id: string;
  amount_cents: number;
  method: string;
  paid_on: string;
  period_month: string | null;
  reference: string | null;
  note: string | null;
};

type TenantMessageRow = {
  id: string;
  channel: string;
  subject: string | null;
  body: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  created_at: string;
};

const labelCls = "mb-1 block text-xs font-medium text-gray-600";
const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

function dollars(cents: number | null): string {
  return cents != null ? (cents / 100).toString() : "";
}

const FLASH: Record<string, string> = {
  saved: "Tenancy saved.",
  created: "Tenancy created.",
  ended: "Tenancy marked ended.",
};
// Lease-document outcomes (?lease=...). `generated`/`deleted` are success-toned;
// the rest are errors handled below.
const LEASE_SUCCESS: Record<string, string> = {
  generated: "Lease generated from your current clause library.",
  deleted: "Lease document deleted.",
  sent: "Lease sent for signature. Each signer has a private signing link.",
  withdrawn: "Lease withdrawn back to draft. You can edit and resend it.",
};
const LEASE_ERROR: Record<string, string> = {
  noclauses:
    "Add at least one clause in Settings → Lease Clauses before generating a lease.",
  noselection:
    "Select at least one clause to include before generating the lease.",
  notfound: "That tenancy could no longer be found.",
  error: "Something went wrong generating the lease. Please try again.",
  notdraft: "That lease was already sent. Refresh to see its signing status.",
  incomplete:
    "Fill every {{value}} in the lease before sending it for signature.",
  cannotwithdraw:
    "This lease can't be withdrawn — someone has already signed it. Generate a new version to make changes.",
};
const TENANT_FLASH: Record<string, string> = {
  added: "Tenant added.",
  removed: "Tenant removed.",
  primary: "Primary tenant updated.",
};
// Manual payment outcomes (?paid=...). `recorded`/`deleted` are success-toned;
// the rest are validation errors handled by paymentErrorMessage.
const PAYMENT_FLASH: Record<string, string> = {
  recorded: "Payment recorded.",
  deleted: "Payment removed.",
};
// Maintenance "Report an issue" outcome (?wo=...). `reported` is success-toned;
// the rest are validation errors handled by workOrderErrorMessage.
const WO_FLASH: Record<string, string> = {
  reported: "Maintenance issue logged. Track it in Maintenance.",
};
// Map the lib/work-orders tone vocabulary onto the shared StatusChip ChipTone.
function woChipTone(
  tone: string,
): "neutral" | "info" | "success" | "warn" | "danger" {
  switch (tone) {
    case "green":
      return "success";
    case "blue":
      return "info";
    case "amber":
      return "warn";
    case "red":
      return "danger";
    default:
      return "neutral";
  }
}
// Rotessa customer-creation outcomes (?rotessa=...). `created`/`already` are
// success-toned; the rest are errors.
const ROTESSA_SUCCESS: Record<string, string> = {
  created: "Rotessa customer created from the primary tenant. You can now set up rent collection for this tenancy.",
  already: "This tenancy already has a Rotessa customer.",
  scheduled: "Monthly rent schedule created in Rotessa. Payments will run automatically on the schedule.",
  schedalready: "This tenancy already has a rent schedule.",
};
const ROTESSA_ERROR: Record<string, string> = {
  notconnected: "Connect your Rotessa account in Settings before creating a customer.",
  noprimary: "This tenancy needs a primary tenant first.",
  noname: "Give the primary tenant a name before creating a Rotessa customer.",
  decfail: "We couldn't read your stored Rotessa key. Reconnect it in Settings.",
  createfail: "Rotessa couldn't create the customer. Check your connection in Settings and try again.",
  forbidden: "You don't have permission to manage rent collection.",
  nocustomer: "Create the Rotessa customer first, then set up the rent schedule.",
  norent: "Set a monthly rent amount on this tenancy before scheduling rent.",
  baddate: "Pick a first payment date at least 2 business days from today.",
  schedfail: "Rotessa couldn't create the rent schedule. The tenant may still need to authorize their bank in Rotessa. Check Settings and try again.",
};
// Stripe Connect rent outcomes (?striperent=...). `synced` is success-toned.
const STRIPE_RENT_SUCCESS: Record<string, string> = {
  synced: "Stripe rent status refreshed.",
  subscribed: "Monthly rent scheduled. Stripe will bill the saved bank account automatically.",
  subsynced: "Subscription status refreshed.",
};
const STRIPE_RENT_ERROR: Record<string, string> = {
  notconfigured: "Payments aren't configured on this deployment yet.",
  notconnected: "Set up Stripe rent collection in Settings first.",
  notready: "Finish your Stripe onboarding in Settings — it can't collect payments yet.",
  noprimary: "This tenancy needs a primary tenant first.",
  noname: "Give the primary tenant a name before starting Stripe authorization.",
  noemail: "The primary tenant needs an email — bank mandates and notices are sent there.",
  nosession: "Start the bank authorization before refreshing.",
  createfail: "Stripe couldn't start the authorization. Try again.",
  linkfail: "Stripe couldn't create the authorization link. Try again.",
  syncfail: "We couldn't refresh the Stripe status just now. Try again.",
  forbidden: "You don't have permission to manage rent collection.",
  subalready: "This tenancy already has a rent subscription.",
  nocustomer: "Authorize the tenant's bank account before scheduling rent.",
  nomandate: "The tenant needs to authorize their bank (mandate) before scheduling rent.",
  nopm: "No saved payment method yet — finish the bank authorization first.",
  norent: "Set a monthly rent amount on this tenancy before scheduling rent.",
  baddate: "Pick a first charge date at least 2 business days from today.",
  subfail: "Stripe couldn't create the rent subscription. Try again.",
  nosub: "Set up the monthly rent subscription before refreshing.",
};

export default async function TenancyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    saved?: string;
    created?: string;
    ended?: string;
    tenant?: string;
    err?: string;
    rotessa?: string;
    striperent?: string;
    reason?: string;
    paid?: string;
    msg?: string;
    s?: string;
    k?: string;
    f?: string;
    lease?: string;
    wo?: string;
    wo_msg?: string;
    wo_id?: string;
    report?: string;
    docs?: string;
    increase?: string;
    insurance?: string;
  };
}) {
  const supabase = createClient();
  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, status, rent_cents, deposit_cents, start_date, end_date, term_months, last_rent_increase_date, payment_notes, move_in_notes, notes, lead_id, rotessa_customer_id, rotessa_customer_synced_at, rotessa_schedule_id, rotessa_schedule_synced_at, stripe_customer_id, stripe_payment_method_id, stripe_mandate_status, stripe_rent_synced_at, stripe_subscription_id, stripe_subscription_status, report_token, property:properties(id, address, rent_control_exempt, first_occupancy_date), tenants(id, name, email, phone, is_primary, sms_opt_out)",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();
  const t = data as unknown as Tenancy;
  const tenants = (t.tenants ?? [])
    .slice()
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const primary = tenants.find((x) => x.is_primary) ?? tenants[0] ?? null;

  // The org's Rotessa connection state (RLS scopes the row to this org). We
  // surface whether rent collection is connected so the Rent-collection card
  // below can show the right call-to-action; the stored key is never read here.
  const { data: rotessaRows } = await supabase
    .from("rotessa_accounts")
    .select("connection_status, api_key_encrypted")
    .limit(1);
  const rotessaRow = rotessaRows?.[0] as
    | { connection_status: string; api_key_encrypted: string | null }
    | undefined;
  const rotessaConnected = !!rotessaRow?.api_key_encrypted;
  const rotessaStatus = rotessaRow?.connection_status ?? "not_connected";

  // The org's Stripe Connect rent rail state (sibling of Rotessa). RLS scopes
  // to this org. Drives the Stripe rent-collection section below.
  const { data: stripeConnectRows } = await supabase
    .from("stripe_connect_accounts")
    .select("connected_account_id, country, charges_enabled, onboarding_state")
    .limit(1);
  const stripeConnectRow = stripeConnectRows?.[0] as
    | { connected_account_id: string; country: string | null; charges_enabled: boolean; onboarding_state: string }
    | undefined;
  const stripeRentView: TenancyStripeRentView = {
    tenancyId: t.id,
    primaryName: primary?.name ?? null,
    primaryHasEmail: !!primary?.email,
    country: stripeConnectRow?.country ?? null,
    connectExists: !!stripeConnectRow?.connected_account_id,
    connectReady: !!stripeConnectRow?.charges_enabled,
    mandateStatus: t.stripe_mandate_status ?? "none",
    paymentMethodId: t.stripe_payment_method_id,
    syncedAt: t.stripe_rent_synced_at,
    stripeConfigured: !!getStripe(),
    rentCents: t.rent_cents,
    rentLabel: formatRentCents(t.rent_cents),
    subscriptionId: t.stripe_subscription_id,
    subscriptionStatus: t.stripe_subscription_status,
    firstChargeDefault: defaultFirstProcessDate(new Date().toISOString().slice(0, 10)),
    firstChargeMin: minProcessDate(new Date().toISOString().slice(0, 10)),
    firstChargeHint: formatProcessDate(defaultFirstProcessDate(new Date().toISOString().slice(0, 10))),
  };
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultProcessDate = defaultFirstProcessDate(todayIso);
  const minProcDate = minProcessDate(todayIso);
  const thisMonth = todayIso.slice(0, 7); // "YYYY-MM" for the period <input type="month">

  // Manual rent payments recorded against this tenancy (newest first). RLS
  // scopes to this org. We reconcile them against the monthly rent below.
  const { data: paymentRows } = await supabase
    .from("rent_payments")
    .select("id, amount_cents, method, paid_on, period_month, reference, note")
    .eq("tenancy_id", t.id)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  const payments = (paymentRows ?? []) as Payment[];
  const reconciliation = reconcilePayments(
    payments.map((p): PaymentRow => ({ amount_cents: p.amount_cents, period_month: p.period_month })),
    t.rent_cents,
  );

  // Maintenance work orders logged against this tenancy (newest first), for the
  // per-tenancy Maintenance panel (work-order module Slice 3). RLS scopes to
  // this org. Full management lives on /dashboard/maintenance.
  const { data: woRows } = await supabase
    .from("work_orders")
    .select(
      "id, title, status, priority, category, scheduled_for, quote_cents, expected_start, expected_finish, trade:trade_contacts(name)",
    )
    .eq("tenancy_id", t.id)
    .order("created_at", { ascending: false });
  const workOrders = (woRows ?? []) as unknown as {
    id: string;
    title: string;
    status: string;
    priority: string;
    category: string;
    scheduled_for: string | null;
    quote_cents: number | null;
    expected_start: string | null;
    expected_finish: string | null;
    trade: { name: string } | null;
  }[];
  const openWorkOrders = workOrders.filter((w) => isActiveStatus(w.status));

  // Org-level saved message templates (for the composer's "start from template"
  // picker) and the send history for this tenancy. RLS scopes both to this org.
  const { data: templateRows } = await supabase
    .from("tenant_message_templates")
    .select("id, name, channel, subject, body")
    .order("name", { ascending: true });
  const templates = (templateRows ?? []) as ComposerTemplate[];

  // Comms tie-in (Slice 4): when deep-linked from a work-order status change
  // (?wo_msg=<status>), resolve the matching maintenance template id so the
  // composer pre-loads it. Falls back to null (blank composer) when the status
  // maps to nothing or the operator renamed/deleted that template.
  const initialTemplateId = findTemplateIdByName(
    templates,
    maintenanceTemplateNameForStatus(searchParams.wo_msg ?? ""),
  );

  // Slice 4: when the message offer carries a work-order id (?wo_id=), pre-fill
  // the composer body with that job's quote + expected window so the operator
  // shares concrete numbers, not just the template's [bracket] gaps. Empty string
  // when the WO has neither set (or the id doesn't match a WO on this tenancy).
  const notifyWorkOrder = searchParams.wo_id
    ? workOrders.find((w) => w.id === searchParams.wo_id)
    : null;
  const initialDetails = notifyWorkOrder
    ? tenantScheduleDetails(notifyWorkOrder)
    : "";

  // Plan gate for the composer (S214): SMS is a paid-tier capability. The server
  // action enforces this regardless; here we mirror it so the composer can hide
  // the locked channels and show an upgrade nudge instead of a silent skip.
  const org = await getCurrentOrg();
  const smsAllowed = canUseSms(org?.plan);

  // Rent-increase status (N1 v1, S282). "Today" is anchored to Ontario time —
  // this is an Ontario LTB feature, and server components run UTC on Vercel.
  // The stored last-increase anchor (tenancies.last_rent_increase_date) + the
  // owner-asserted exemption (properties.rent_control_exempt) are fed in so this
  // card matches the autopilot sweep exactly — both are set from the "Watch a
  // lease" confirm flow. Shown only for an active tenancy with a rent set.
  const todayOntario = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
  });
  const rentIncrease =
    t.status === "active" && t.rent_cents != null && t.start_date
      ? deriveRentIncrease(
          {
            startDate: t.start_date,
            currentRentCents: t.rent_cents,
            lastIncreaseDate: t.last_rent_increase_date ?? null,
            exempt: t.property?.rent_control_exempt === true,
          },
          todayOntario,
        )
      : null;

  const { data: messageRows } = await supabase
    .from("tenant_messages")
    .select(
      "id, channel, subject, body, recipient_count, sent_count, failed_count, skipped_count, created_at",
    )
    .eq("tenancy_id", t.id)
    .order("created_at", { ascending: false })
    .limit(20);
  const messages = (messageRows ?? []) as TenantMessageRow[];

  // Generated lease documents for this tenancy (newest first). RLS scopes to
  // this org. The two most recent power the renewal diff (#11 slice 2).
  const { data: leaseRows } = await supabase
    .from("lease_documents")
    .select("id, title, status, assembled_body, executed_clause_versions, created_at, executed_at")
    .eq("tenancy_id", t.id)
    .order("created_at", { ascending: false });
  // Signers across all of this tenancy's leases (one query; grouped in code).
  // RLS scopes to this org. Powers the per-signer status + magic-link UI.
  const { data: signerRows } = await supabase
    .from("lease_signers")
    .select("id, lease_document_id, role, name, status, token, sign_order")
    .eq("organization_id", org?.id ?? "")
    .order("sign_order", { ascending: true });
  const signersByLease = new Map<string, LeaseSignerView[]>();
  for (const r of (signerRows ?? []) as {
    lease_document_id: string;
    role: string;
    name: string | null;
    status: string;
    token: string;
  }[]) {
    const arr = signersByLease.get(r.lease_document_id) ?? [];
    arr.push({ role: r.role, name: r.name, status: r.status, token: r.token });
    signersByLease.set(r.lease_document_id, arr);
  }
  const leaseRowsTyped = (leaseRows ?? []) as {
    id: string;
    title: string;
    status: string;
    assembled_body: string | null;
    executed_clause_versions: ExecutedClauseRef[] | null;
    created_at: string;
    executed_at: string | null;
  }[];
  const leaseDocs = leaseRowsTyped.map(
    (d): LeaseDocView => ({
      id: d.id,
      title: d.title,
      status: d.status,
      assembled_body: d.assembled_body,
      executed_clause_versions: d.executed_clause_versions ?? [],
      created_at: d.created_at,
      signers: signersByLease.get(d.id) ?? [],
    }),
  );
  // Slice 4: executed in-app leases surface in the document vault as read-only
  // linked entries (one unified history alongside uploaded files).
  const inAppLeaseEntries = executedLeaseVaultEntries(leaseRowsTyped);

  // Document vault (Slices 1+2): stored documents for this tenancy (newest
  // first, soft-deleted excluded) + their share links. RLS scopes both to this
  // org. We mint short-lived signed download URLs for the private bucket here
  // (the operator's RLS client; the 0076 SELECT policy authorizes it).
  const { data: docRows } = await supabase
    .from("documents")
    .select("id, title, doc_type, size_bytes, storage_path, created_at, person_id, source, lease_document_id")
    .eq("tenancy_id", t.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const allDocList = (docRows ?? []) as {
    id: string;
    title: string;
    doc_type: string;
    size_bytes: number;
    storage_path: string;
    created_at: string;
    person_id: string | null;
    source: string | null;
    lease_document_id: string | null;
  }[];
  // Slice 4b (Option C): a stored PDF of an in-app executed lease folds into that
  // lease's "Signed in app" entry instead of the uploaded-files list, so each
  // executed lease shows exactly once. Everything else stays in `docList` (the
  // uploaded list). An orphaned in_app_executed row (lease no longer executed /
  // lease_document_id SET NULL) falls back into the uploaded list.
  const executedLeaseIds = inAppLeaseEntries.map((e) => e.id);
  const { uploaded: docList, executedPdfByLeaseId } = partitionVaultDocuments(
    allDocList,
    executedLeaseIds,
  );
  // Resolve a friendly display name for each document's filed-about person
  // (Slice 3 person filing). RLS scopes the persons read to this org.
  const docPersonIds = Array.from(
    new Set(docList.map((d) => d.person_id).filter((p): p is string => !!p)),
  );
  const personNameById = new Map<string, string>();
  if (docPersonIds.length > 0) {
    const { data: personRows } = await supabase
      .from("persons")
      .select("id, full_name, email, phone")
      .in("id", docPersonIds);
    for (const p of (personRows ?? []) as {
      id: string;
      full_name: string | null;
      email: string | null;
      phone: string | null;
    }[]) {
      personNameById.set(p.id, personDisplayName(p));
    }
  }
  // Share links + signed URLs cover ALL live docs (uploaded + the stored
  // executed-lease PDFs) so a folded PDF is downloadable + shareable too.
  const { data: shareRows } = await supabase
    .from("document_share_links")
    .select("id, document_id, token, expires_at, revoked_at")
    .in("document_id", allDocList.length > 0 ? allDocList.map((d) => d.id) : ["00000000-0000-0000-0000-000000000000"])
    .order("created_at", { ascending: false });
  const nowForShares = new Date();
  const sharesByDoc = new Map<
    string,
    { id: string; token: string; status: "active" | "expired" | "revoked"; expires_at: string | null }[]
  >();
  for (const r of (shareRows ?? []) as {
    id: string;
    document_id: string;
    token: string;
    expires_at: string | null;
    revoked_at: string | null;
  }[]) {
    const arr = sharesByDoc.get(r.document_id) ?? [];
    arr.push({
      id: r.id,
      token: r.token,
      status: shareLinkStatus(r, nowForShares),
      expires_at: r.expires_at,
    });
    sharesByDoc.set(r.document_id, arr);
  }
  const docSigned = await createDocumentDownloadUrls(
    supabase,
    allDocList.map((d) => d.storage_path),
  );
  const docUrlByPath = new Map<string, string | null>();
  if (docSigned.ok) {
    for (const u of docSigned.urls) docUrlByPath.set(u.path, u.signedUrl);
  }
  const documents: DocumentView[] = docList.map((d) => ({
    id: d.id,
    title: d.title,
    doc_type: d.doc_type,
    size_bytes: d.size_bytes,
    created_at: d.created_at,
    aboutPersonName: d.person_id ? personNameById.get(d.person_id) ?? null : null,
    signedUrl: docUrlByPath.get(d.storage_path) ?? null,
    shareLinks: sharesByDoc.get(d.id) ?? [],
  }));

  // Slice 4b (Option C): enrich each executed-lease vault entry with its stored
  // PDF (if the operator has filed one), so the "Signed in app" entry offers
  // Download + Share on the PDF — or a "File signed PDF" action when absent.
  const inAppLeases: InAppLeaseView[] = inAppLeaseEntries.map((e) => {
    const pdf = executedPdfByLeaseId.get(e.id);
    return {
      ...e,
      storedPdf: pdf
        ? {
            id: pdf.id,
            size_bytes: pdf.size_bytes,
            created_at: pdf.created_at,
            signedUrl: docUrlByPath.get(pdf.storage_path) ?? null,
            shareLinks: sharesByDoc.get(pdf.id) ?? [],
          }
        : null,
    };
  });

  // The org clause library powers the clause-selection wizard (#11 slice 7).
  // RLS scopes both reads to this org. We resolve each clause to its current
  // version and enrich with the slice-6 display metadata (category / risk /
  // landlord note) the wizard renders.
  const { data: clauseRows } = await supabase
    .from("lease_clauses")
    .select("id, key, title, applicable_to, category, risk_level, notes_for_landlord")
    .order("category", { ascending: true })
    .order("key", { ascending: true });
  const { data: clauseVersionRows } = await supabase
    .from("lease_clause_versions")
    .select("id, clause_id, version, is_current, body");
  const clauseMeta = new Map(
    ((clauseRows ?? []) as {
      id: string;
      category: string | null;
      risk_level: RiskLevel | null;
      notes_for_landlord: string | null;
    }[]).map((r) => [r.id, r]),
  );
  const wizardClauses: WizardClause[] = resolveCurrentClauses(
    (clauseRows ?? []) as ClauseRowLike[],
    (clauseVersionRows ?? []) as ClauseVersionRowLike[],
  ).map((c) => {
    const meta = clauseMeta.get(c.clauseId);
    return {
      clauseId: c.clauseId,
      key: c.key,
      title: c.title,
      applicableTo: c.applicableTo,
      versionId: c.versionId,
      version: c.version,
      body: c.body,
      category: meta?.category ?? "Other",
      riskLevel: meta?.risk_level ?? "standard",
      notesForLandlord: meta?.notes_for_landlord ?? null,
    };
  });
  // Canonical tokens the wizard fills automatically (preview only; the server
  // re-derives them) + the read-only "filled from this tenancy" summary.
  const recordVars = buildLeaseVars({
    propertyAddress: t.property?.address ?? null,
    tenantName: primary?.name ?? null,
    rent: t.rent_cents != null ? formatRentCents(t.rent_cents) : null,
    deposit: t.deposit_cents != null ? formatRentCents(t.deposit_cents) : null,
    startDate: t.start_date,
    endDate: t.end_date,
  });
  const recordSummary = [
    { label: "Property", value: t.property?.address ?? "" },
    { label: "Primary tenant", value: primary?.name ?? "" },
    { label: "Rent", value: t.rent_cents != null ? formatRentCents(t.rent_cents) : "" },
    { label: "Deposit", value: t.deposit_cents != null ? formatRentCents(t.deposit_cents) : "" },
    { label: "Start", value: t.start_date ?? "" },
    { label: "End", value: t.end_date ?? "" },
  ].filter((r) => r.value);
  // Suggest the prorated-rent fact when the lease starts mid-month.
  const proratedDefault = !!t.start_date && Number(t.start_date.slice(8, 10)) !== 1;

  // "Start from last signed lease" (REAL-WORLD-INTAKE item J): the org's most
  // recently SIGNED lease seeds a new lease's clause selection. Org-wide (not
  // just this tenancy) so it works for a brand-new unit, not only a renewal. We
  // read that snapshot + the unit/date for the affordance label; the pure
  // seedSelectionFromSnapshot maps it to the CURRENT library clauseIds (so the
  // new lease assembles current wording, never the old pinned version). RLS
  // scopes the read to this org.
  const { data: lastSignedRow } = await supabase
    .from("lease_documents")
    .select(
      "id, executed_at, created_at, executed_clause_versions, tenancy:tenancies(property:properties(address))",
    )
    .eq("organization_id", org?.id ?? "")
    .eq("status", "executed")
    .order("executed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSigned = lastSignedRow as unknown as {
    id: string;
    executed_at: string | null;
    created_at: string;
    executed_clause_versions: ExecutedClauseRef[] | null;
    tenancy: { property: { address: string } | null } | null;
  } | null;
  let leaseSeed: LeaseSeedInfo | null = null;
  if (lastSigned) {
    const sel = seedSelectionFromSnapshot(
      wizardClauses,
      lastSigned.executed_clause_versions ?? [],
    );
    if (sel.clauseIds.length > 0) {
      leaseSeed = {
        clauseIds: sel.clauseIds,
        missingCount: sel.missingKeys.length,
        sourceAddress: lastSigned.tenancy?.property?.address ?? null,
        signedAt: lastSigned.executed_at ?? lastSigned.created_at,
      };
    }
  }

  const composerTenants: ComposerTenant[] = tenants.map((tn) => ({
    id: tn.id,
    name: tn.name,
    email: tn.email,
    phone: tn.phone,
    sms_opt_out: tn.sms_opt_out,
  }));

  // Tenant-message send outcome (?msg=...). `sent` is success (with counts);
  // `noone` means everyone selected was skipped; the rest are validation errors.
  const msgCounts = {
    s: parseInt(searchParams.s ?? "0", 10) || 0,
    k: parseInt(searchParams.k ?? "0", 10) || 0,
    f: parseInt(searchParams.f ?? "0", 10) || 0,
  };
  const msgFlash =
    searchParams.msg === "sent"
      ? `Message sent to ${msgCounts.s} recipient${msgCounts.s === 1 ? "" : "s"}.` +
        (msgCounts.k > 0 ? ` ${msgCounts.k} skipped (no contact details or opted out).` : "") +
        (msgCounts.f > 0 ? ` ${msgCounts.f} failed to send.` : "")
      : null;
  const msgError =
    searchParams.msg === "failed"
      ? "We couldn't send the message. Check that email/SMS is configured and try again."
      : searchParams.msg === "noone"
        ? "Nobody was messaged — the selected tenants have no usable contact details for that channel (or opted out of texts)."
        : searchParams.msg && searchParams.msg !== "sent"
          ? commsErrorMessage(searchParams.msg)
          : null;

  // Document-vault outcome (?docs=...). `uploaded:N`/`deleted`/`shared`/`revoked`
  // are success-toned; the rest are errors.
  const docsParam = searchParams.docs ?? "";
  const docsUploadedMatch = /^uploaded:(\d+)$/.exec(docsParam);
  const docsFlash = docsUploadedMatch
    ? `${docsUploadedMatch[1]} document${docsUploadedMatch[1] === "1" ? "" : "s"} uploaded.`
    : docsParam === "deleted"
      ? "Document deleted."
      : docsParam === "shared"
        ? "Read-only share link created. Copy it from the document below."
        : docsParam === "revoked"
          ? "Share link revoked."
          : docsParam === "filed"
            ? "Signed lease PDF filed. It's stored under the lease below and ready to download or share."
            : null;
  const DOCS_ERROR: Record<string, string> = {
    none: "Choose at least one file to upload.",
    toomany: "Too many files at once. Upload up to 10 at a time.",
    failed: "We couldn't store that file. Please try again.",
    type: "Unsupported file. Upload a PDF, or a scan image (JPG, PNG, WebP).",
    size: "That file is too large. Documents must be under 25 MB.",
    empty: "That file appears to be empty.",
    shareerr: "We couldn't create the share link. Please try again.",
    notexecuted: "Only an executed (fully signed) lease can be filed as a PDF.",
    forbidden: "You don't have permission to manage documents.",
    error: "Something went wrong. Please try again.",
  };
  const docsError =
    docsParam && !docsFlash ? (DOCS_ERROR[docsParam] ?? null) : null;

  // Record-rent-increase outcome (?increase=...). `recorded` is success-toned.
  const INCREASE_ERROR: Record<string, string> = {
    baddate: "Pick the date the increase takes effect.",
    before_start: "The increase date can't be before the lease start.",
  };
  const increaseFlash =
    searchParams.increase === "recorded"
      ? "Rent increase recorded — the next eligible date has moved forward a year."
      : null;
  const increaseError =
    searchParams.increase && !increaseFlash
      ? (INCREASE_ERROR[searchParams.increase] ?? null)
      : null;

  const insuranceFlash =
    searchParams.insurance === "added"
      ? "Insurance policy added."
      : searchParams.insurance === "updated"
        ? "Insurance policy updated."
        : searchParams.insurance === "removed"
          ? "Insurance policy removed."
          : null;
  const insuranceError =
    searchParams.insurance === "forbidden"
      ? "You don't have permission to manage this tenancy's insurance."
      : searchParams.insurance === "notfound"
        ? "That insurance policy could not be found."
        : null;

  const flash =
    docsFlash ||
    insuranceFlash ||
    increaseFlash ||
    (searchParams.saved && FLASH.saved) ||
    (searchParams.created && FLASH.created) ||
    (searchParams.ended && FLASH.ended) ||
    (searchParams.tenant && TENANT_FLASH[searchParams.tenant]) ||
    (searchParams.rotessa && ROTESSA_SUCCESS[searchParams.rotessa]) ||
    (searchParams.striperent && STRIPE_RENT_SUCCESS[searchParams.striperent]) ||
    (searchParams.paid && PAYMENT_FLASH[searchParams.paid]) ||
    (searchParams.lease && LEASE_SUCCESS[searchParams.lease]) ||
    (searchParams.wo && WO_FLASH[searchParams.wo]) ||
    msgFlash ||
    null;
  const errMsg =
    tenancyErrorMessage(searchParams.err) ||
    (searchParams.rotessa ? ROTESSA_ERROR[searchParams.rotessa] ?? null : null) ||
    (searchParams.striperent && !STRIPE_RENT_SUCCESS[searchParams.striperent]
      ? (STRIPE_RENT_ERROR[searchParams.striperent] ?? null) &&
        `${STRIPE_RENT_ERROR[searchParams.striperent]}${
          searchParams.reason ? ` (${searchParams.reason})` : ""
        }`
      : null) ||
    (searchParams.paid && !PAYMENT_FLASH[searchParams.paid]
      ? paymentErrorMessage(searchParams.paid)
      : null) ||
    (searchParams.lease && !LEASE_SUCCESS[searchParams.lease]
      ? (LEASE_ERROR[searchParams.lease] ?? null)
      : null) ||
    (searchParams.wo && !WO_FLASH[searchParams.wo]
      ? workOrderErrorMessage(searchParams.wo)
      : null) ||
    increaseError ||
    docsError ||
    insuranceError ||
    msgError;

  // Section status lines (S283) — shown on each collapsed header so the
  // operator reads the tenancy's state without expanding every section.
  const tenantsStatus = `${tenants.length} on lease`;
  const leaseDetailsStatus = `${formatRentCents(t.rent_cents)}${t.rent_cents != null ? "/mo" : ""}`;
  const hasExecutedLease = leaseDocs.some((d) => d.status === "executed");
  const leaseDocStatus: LeaseDocStatusLabel = hasExecutedLease
    ? "Signed"
    : leaseDocs.some((d) => d.status === "sent")
      ? "Sent for signature"
      : leaseDocs.some((d) => d.status === "draft")
        ? "Draft"
        : "Not started";
  const rentAutomatic =
    !!t.rotessa_schedule_id ||
    (!!stripeRentView.subscriptionId &&
      stripeRentView.subscriptionStatus === "active");
  const rentCollectionStatus: RentCollectionStatusLabel = rentAutomatic
    ? "Automatic monthly debit"
    : t.rotessa_customer_id || stripeRentView.paymentMethodId
      ? "Authorized — not scheduled"
      : "Not set up";
  const paymentsStatus =
    payments.length > 0
      ? `${payments.length} logged · ${formatMoneyCents(reconciliation.totalCollectedCents)}`
      : "None logged";
  const maintenanceStatus =
    openWorkOrders.length > 0
      ? `${openWorkOrders.length} open`
      : workOrders.length > 0
        ? "All clear"
        : "None logged";
  const messagesStatus =
    messages.length > 0 ? `${messages.length} sent` : "None sent";
  // Count uploaded files + executed in-app leases surfaced in the vault (Slice 4)
  // so the collapsed header reflects everything inside, not just uploads.
  const documentsCount = documents.length + inAppLeaseEntries.length;
  const documentsStatus =
    documentsCount > 0 ? `${documentsCount} stored` : "None stored";

  // Renter's-insurance policies (S382): logged proof-of-insurance for this
  // tenancy. RLS scopes the read to this org. Each policy's status is computed
  // here (expiring within the lead window / lapsed past expiry) so the section
  // stays presentational and the collapsed header reflects what needs attention.
  const { data: insRows } = await supabase
    .from("tenancy_insurance")
    .select(
      "id, provider, policy_number, coverage_amount_cents, effective_date, expiry_date, notes",
    )
    .eq("tenancy_id", t.id)
    .order("expiry_date", { ascending: true });
  const insuranceViews: InsuranceView[] = ((insRows ?? []) as any[]).map((r) => ({
    id: r.id,
    provider: r.provider ?? null,
    policy_number: r.policy_number ?? null,
    coverage_amount_cents: r.coverage_amount_cents ?? null,
    effective_date: r.effective_date ?? null,
    expiry_date: r.expiry_date ?? null,
    notes: r.notes ?? null,
    status: insuranceStatusFor(
      { provider: r.provider, expiry_date: r.expiry_date },
      todayOntario,
    ),
  }));
  const insuranceAttention = insuranceViews.filter(
    (p) => p.status === "lapsed" || p.status === "expiring_soon",
  ).length;
  const insuranceStatusLabel =
    insuranceViews.length === 0
      ? "None logged"
      : insuranceAttention > 0
        ? `${insuranceAttention} need${insuranceAttention === 1 ? "s" : ""} attention`
        : "Active";
  const RENT_INCREASE_STATUS_LABEL: Record<string, string> = {
    scheduled: "Scheduled",
    serve_window: "Serve now",
    serve_late: "Serve now · late",
    overdue: "Overdue",
    exempt: "Exempt",
  };

  // Smart default-open (S286): open the one section that needs attention now,
  // instead of always-Tenants. Falls back to Tenants when nothing's pending.
  const openSection = pickDefaultOpenSection({
    tenantCount: tenants.length,
    leaseDocStatus,
    rentCollectionStatus,
    rentIncreaseStatus: rentIncrease?.status ?? null,
  });

  return (
    <div>
      <Link
        href="/dashboard/tenancies"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← Tenancies
      </Link>

      <PageHeader
        icon={<Icons.key />}
        eyebrow="Tenancy"
        title={primary?.name || primary?.email || "Tenancy"}
        subtitle={
          <>
            {t.property ? (
              <Link
                href={`/dashboard/properties/${t.property.id}`}
                className="font-medium text-brand hover:underline"
              >
                {t.property.address}
              </Link>
            ) : (
              "Unit removed"
            )}
            {" · "}
            {formatRentCents(t.rent_cents)}
            {t.rent_cents != null ? "/mo" : ""} · from {t.start_date}
            {t.end_date ? ` to ${t.end_date}` : ""}
          </>
        }
        action={
          <StatusChip tone={tenancyStatusTone(t.status)}>
            {tenancyStatusLabel(t.status)}
          </StatusChip>
        }
      />

      {flash && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {flash}
        </p>
      )}
      {errMsg && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {errMsg}
        </p>
      )}

      {/* Tenants roster --------------------------------------------------- */}
      <CollapsibleSection
        id="tenants"
        title="Tenants & contacts"
        status={tenantsStatus}
        defaultOpen={openSection === "tenants"}
      >
      <ul className="mb-3 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {tenants.map((tn) => (
          <li key={tn.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <span className="min-w-0">
              <span className="text-gray-900">{tn.name || "Unnamed tenant"}</span>
              {tn.is_primary && (
                <StatusChip tone="brand">Primary</StatusChip>
              )}
              <span className="ml-2 block text-xs text-gray-500">
                {[tn.email, tn.phone].filter(Boolean).join(" · ") || "No contact details"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {!tn.is_primary && (
                <form action={makePrimaryTenant}>
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <input type="hidden" name="tenant_id" value={tn.id} />
                  <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    Make primary
                  </button>
                </form>
              )}
              {tenants.length > 1 && (
                <form action={removeTenant}>
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <input type="hidden" name="tenant_id" value={tn.id} />
                  <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    Remove
                  </button>
                </form>
              )}
            </span>
          </li>
        ))}
      </ul>
      {tenants.length < MAX_TENANTS_PER_TENANCY && (
        <form
          action={addTenant}
          className="mb-8 flex flex-wrap items-end gap-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
        >
          <input type="hidden" name="tenancy_id" value={t.id} />
          <div className="min-w-[10rem] flex-1">
            <label className={labelCls}>Add co-tenant — name</label>
            <input name="name" placeholder="Full name" className={inputCls} />
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className={labelCls}>Email</label>
            <input name="email" type="email" className={inputCls} />
          </div>
          <div className="w-36">
            <label className={labelCls}>Phone</label>
            <input name="phone" className={inputCls} />
          </div>
          <button className={SECONDARY_ACTION_CLASS}>Add tenant</button>
        </form>
      )}
      </CollapsibleSection>

      {/* Lease details (edit) -------------------------------------------- */}
      <CollapsibleSection title="Lease details" status={leaseDetailsStatus}>
      <form
        action={updateTenancy}
        className="mb-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <input type="hidden" name="id" value={t.id} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Lease start</label>
            <input type="date" name="start_date" required defaultValue={t.start_date} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Lease end (optional)</label>
            <input type="date" name="end_date" defaultValue={t.end_date ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Term (months — blank = month-to-month)</label>
            <input
              type="number"
              name="term_months"
              step="1"
              min="1"
              defaultValue={t.term_months ?? ""}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select name="status" defaultValue={t.status} className={inputCls}>
              {TENANCY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {tenancyStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Monthly rent ($)</label>
            <input type="number" name="rent" step="1" min="0" defaultValue={dollars(t.rent_cents)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Deposit ($)</label>
            <input type="number" name="deposit" step="1" min="0" defaultValue={dollars(t.deposit_cents)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Payment / deposit notes</label>
            <textarea name="payment_notes" rows={2} defaultValue={t.payment_notes ?? ""} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Move-in notes</label>
            <textarea name="move_in_notes" rows={2} defaultValue={t.move_in_notes ?? ""} className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Other notes</label>
            <textarea name="notes" rows={2} defaultValue={t.notes ?? ""} className={inputCls} />
          </div>
        </div>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Save changes
        </button>
      </form>
      </CollapsibleSection>

      {/* Lease document (clause-selection wizard + renewal diff) ---------- */}
      <CollapsibleSection
        id="lease-document"
        title="Lease document"
        status={leaseDocStatus}
        done={hasExecutedLease}
        defaultOpen={openSection === "lease-document"}
      >
      <TenancyLeaseSection
        tenancyId={t.id}
        leaseDocs={leaseDocs}
        wizardClauses={wizardClauses}
        recordVars={recordVars}
        recordSummary={recordSummary}
        proratedDefault={proratedDefault}
        rentCents={t.rent_cents}
        startDate={t.start_date ?? null}
        seed={leaseSeed}
        headingHidden
      />
      </CollapsibleSection>

      {/* Document vault (Slices 1+2) ------------------------------------- */}
      <CollapsibleSection id="documents" title="Documents" status={documentsStatus}>
        <TenancyDocumentsSection
          tenancyId={t.id}
          documents={documents}
          inAppLeases={inAppLeases}
          tenants={tenants
            .filter((tn) => (tn.name ?? "").trim().length > 0)
            .map((tn): DocumentTenantOption => ({ id: tn.id, name: tn.name as string }))}
        />
      </CollapsibleSection>

      {/* Renter's insurance (S382) --------------------------------------- */}
      <CollapsibleSection
        id="insurance"
        title="Renter's insurance"
        status={insuranceStatusLabel}
      >
        <TenancyInsuranceSection tenancyId={t.id} policies={insuranceViews} />
      </CollapsibleSection>

      {/* Rent increase (N1 v1) ------------------------------------------- */}
      {rentIncrease && (
        <CollapsibleSection
          id="rent-increase"
          title="Rent increase"
          status={RENT_INCREASE_STATUS_LABEL[rentIncrease.status] ?? undefined}
          defaultOpen={openSection === "rent-increase"}
        >
          <div className="mb-3">
            <RentIncreaseCard
              result={rentIncrease}
              n1Href={`/dashboard/tenancies/${t.id}/n1`}
            />
          </div>
          {/* Set/confirm the inputs the autopilot derives from. The card +
              cron read last_rent_increase_date + the property exemption; this
              links to the prefilled "Watch a lease" confirm flow to set them. */}
          <p className="mb-8 text-xs text-gray-500">
            {t.last_rent_increase_date
              ? `Last increase on file: ${t.last_rent_increase_date}.`
              : "No last-increase date on file — the clock runs from the lease start."}
            {t.property?.rent_control_exempt ? " Marked rent-control exempt." : ""}{" "}
            <Link
              href={`/dashboard/tenancies/watch?tenancy=${t.id}`}
              className="font-medium text-brand hover:underline"
            >
              Set the rent-increase clock &amp; exemption →
            </Link>
          </p>

          {/* Loop-closer: once you've served the increase, record it so the
              autopilot rolls the anniversary forward and re-arms next year.
              Prefilled from the derived effective date + new amount; both
              editable. Hidden for exempt units (no guideline amounts). */}
          {rentIncrease.status !== "exempt" && (
            <form
              action={recordRentIncrease}
              className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
            >
              <input type="hidden" name="id" value={t.id} />
              <p className="text-sm font-semibold text-gray-700">
                Served this increase?
              </p>
              <p className="mb-3 text-xs text-gray-500">
                Record it to reset the clock — we&apos;ll start counting toward
                next year&apos;s eligible date from the effective date below.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelCls}>Effective date</label>
                  <input
                    type="date"
                    name="effective_date"
                    required
                    defaultValue={rentIncrease.effectiveDate}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>New monthly rent ($)</label>
                  <input
                    type="number"
                    name="new_rent"
                    step="1"
                    min="0"
                    defaultValue={
                      rentIncrease.newRentCents != null
                        ? Math.round(rentIncrease.newRentCents / 100).toString()
                        : dollars(t.rent_cents)
                    }
                    className={inputCls}
                  />
                </div>
                <button
                  type="submit"
                  className={SECONDARY_ACTION_CLASS}
                >
                  Record increase
                </button>
              </div>
            </form>
          )}
        </CollapsibleSection>
      )}

      {/* Rent collection (Rotessa + Stripe) ------------------------------ */}
      <CollapsibleSection
        id="rent-collection"
        title="Rent collection"
        status={rentCollectionStatus}
        done={rentAutomatic}
        defaultOpen={openSection === "rent-collection"}
      >
      {/* Stripe Connect — primary rent rail (shown first for now; Rotessa's
          multi-tenant Platform API is closed to new clients, so Stripe is the
          productized path). Rotessa stays below as the secondary rail. */}
      <TenancyStripeRentSection view={stripeRentView} />

      {/* Rotessa (pre-authorized debit — secondary rail) ------------------ */}
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {t.rotessa_customer_id ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone="success">Customer on file</StatusChip>
              <span className="text-sm text-gray-600">
                {primary?.name || "Primary tenant"} is set up as a Rotessa customer.
              </span>
            </div>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-gray-500">Rotessa customer ID</dt>
                <dd className="font-mono text-xs text-gray-700">{t.rotessa_customer_id}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Created</dt>
                <dd className="font-medium text-gray-900">
                  {t.rotessa_customer_synced_at
                    ? new Date(t.rotessa_customer_synced_at).toLocaleString()
                    : "—"}
                </dd>
              </div>
            </dl>

            {/* Monthly rent schedule (increment 3) ------------------------ */}
            <div className="border-t border-gray-100 pt-4">
              {t.rotessa_schedule_id ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone="success">Rent schedule active</StatusChip>
                    <span className="text-sm text-gray-600">
                      {formatRentCents(t.rent_cents)}/mo, billed monthly to the primary tenant.
                    </span>
                  </div>
                  <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-gray-500">Rotessa schedule ID</dt>
                      <dd className="font-mono text-xs text-gray-700">{t.rotessa_schedule_id}</dd>
                    </div>
                    <div>
                      <dt className="text-gray-500">Set up</dt>
                      <dd className="font-medium text-gray-900">
                        {t.rotessa_schedule_synced_at
                          ? new Date(t.rotessa_schedule_synced_at).toLocaleString()
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-gray-400">
                    Payments run automatically. Manage or cancel the schedule from
                    your Rotessa dashboard.
                  </p>
                </div>
              ) : t.rent_cents == null ? (
                <p className="text-sm text-gray-600">
                  Set a monthly rent amount in Lease details below, then you can
                  schedule automatic rent collection.
                </p>
              ) : (
                <form action={createRotessaSchedule} className="space-y-3">
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <p className="text-sm text-gray-600">
                    Schedule automatic monthly rent of{" "}
                    <span className="font-medium text-gray-900">{formatRentCents(t.rent_cents)}</span>{" "}
                    starting on your chosen date. Your tenant must have authorized
                    their bank in Rotessa first.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label className={labelCls}>First payment date</label>
                      <input
                        type="date"
                        name="process_date"
                        required
                        min={minProcDate}
                        defaultValue={defaultProcessDate}
                        className={inputCls}
                      />
                      <span className="mt-1 block text-xs text-gray-400">
                        At least 2 business days out (e.g. {formatProcessDate(defaultProcessDate)}).
                      </span>
                    </div>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                      style={{ background: "var(--brand-gradient, var(--brand-color))" }}
                    >
                      Set up monthly rent
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        ) : !rotessaConnected ? (
          <p className="text-sm text-gray-600">
            Connect your Rotessa account in{" "}
            <Link href="/dashboard/settings#rotessa" className="font-medium text-brand hover:underline">
              Settings
            </Link>{" "}
            to collect rent by pre-authorized debit for this tenancy.
          </p>
        ) : !primary?.name ? (
          <p className="text-sm text-gray-600">
            Add a name to the primary tenant above before creating a Rotessa
            customer.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Create a Rotessa customer for{" "}
              <span className="font-medium text-gray-900">{primary.name}</span>{" "}
              (the primary tenant) to start collecting rent. We send only their
              name and contact details — never bank account numbers.
            </p>
            {rotessaStatus === "error" && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Your last Rotessa connection check reported an error. If creating
                the customer fails, re-test the connection in Settings.
              </p>
            )}
            <form action={createRotessaCustomer}>
              <input type="hidden" name="tenancy_id" value={t.id} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                style={{ background: "var(--brand-gradient, var(--brand-color))" }}
              >
                Create Rotessa customer
              </button>
            </form>
          </div>
        )}
      </div>
      </CollapsibleSection>

      {/* Manual payments (e-transfer / cheque / cash) -------------------- */}
      <CollapsibleSection title="Payments received" status={paymentsStatus}>
      <div className="mb-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-600">
          Record rent you collected manually (e-transfer, cheque, or cash) and
          reconcile it against the monthly rent. This is a bookkeeping log — no
          money moves here. For automatic pre-authorized debit, use rent
          collection above.
        </p>

        {/* Reconcile summary by rent period */}
        {payments.length > 0 && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Reconciliation
              </span>
              <span className="text-sm text-gray-700">
                Total collected:{" "}
                <span className="font-semibold text-gray-900">
                  {formatMoneyCents(reconciliation.totalCollectedCents)}
                </span>
              </span>
            </div>
            <ul className="divide-y divide-gray-100">
              {reconciliation.buckets.map((b) => (
                <li
                  key={b.period ?? "unassigned"}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-gray-900">{b.label}</span>
                    {b.status === "paid" && b.expectedCents != null && (
                      <StatusChip tone="success">Paid</StatusChip>
                    )}
                    {b.status === "short" && <StatusChip tone="warn">Short</StatusChip>}
                    {b.status === "over" && <StatusChip tone="info">Over</StatusChip>}
                    {b.status === "unassigned" && (
                      <StatusChip tone="neutral">Unassigned</StatusChip>
                    )}
                    <span className="text-xs text-gray-400">
                      {b.count} payment{b.count === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="text-gray-700">
                    {formatMoneyCents(b.collectedCents)}
                    {b.expectedCents != null && (
                      <span className="text-gray-400">
                        {" / "}
                        {formatMoneyCents(b.expectedCents)}
                        {b.balanceCents != null && b.balanceCents !== 0 && (
                          <span
                            className={
                              b.balanceCents < 0 ? "text-amber-600" : "text-blue-600"
                            }
                          >
                            {" ("}
                            {b.balanceCents < 0 ? "" : "+"}
                            {formatMoneyCents(b.balanceCents)}
                            {")"}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Ledger of individual payments */}
        {payments.length > 0 && (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">
                    {formatMoneyCents(p.amount_cents)}
                  </span>
                  <span className="ml-2 text-gray-500">
                    {paymentMethodLabel(p.method)} · {p.paid_on}
                  </span>
                  <span className="ml-2 block text-xs text-gray-400">
                    {formatPeriodMonth(p.period_month)}
                    {p.reference ? ` · Ref ${p.reference}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                <form action={deletePayment} className="shrink-0">
                  <input type="hidden" name="tenancy_id" value={t.id} />
                  <input type="hidden" name="payment_id" value={p.id} />
                  <button className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        {/* Record-payment form */}
        <form
          action={recordPayment}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"
        >
          <input type="hidden" name="tenancy_id" value={t.id} />
          <div className="w-28">
            <label className={labelCls}>Amount ($)</label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              defaultValue={dollars(t.rent_cents)}
              className={inputCls}
            />
          </div>
          <div className="w-36">
            <label className={labelCls}>Method</label>
            <select name="method" defaultValue="e_transfer" className={inputCls}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {paymentMethodLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-40">
            <label className={labelCls}>Date received</label>
            <input
              name="paid_on"
              type="date"
              required
              defaultValue={todayIso}
              className={inputCls}
            />
          </div>
          <div className="w-36">
            <label className={labelCls}>For month (optional)</label>
            <input name="period_month" type="month" defaultValue={thisMonth} className={inputCls} />
          </div>
          <div className="w-32">
            <label className={labelCls}>Reference (optional)</label>
            <input name="reference" placeholder="Cheque #" className={inputCls} />
          </div>
          <div className="min-w-[8rem] flex-1">
            <label className={labelCls}>Note (optional)</label>
            <input name="note" className={inputCls} />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Record payment
          </button>
        </form>
      </div>
      </CollapsibleSection>

      {/* Maintenance (work-order module Slice 3) -------------------------- */}
      <CollapsibleSection id="maintenance" title="Maintenance" status={maintenanceStatus}>
      <div className="mb-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-gray-600">
            Repair and maintenance jobs for this unit. Log an issue here; assign a
            trade, set a cost, and track it to done in Maintenance.
          </p>
          <Link
            href="/dashboard/maintenance"
            className="shrink-0 text-sm font-medium text-brand hover:underline"
          >
            Open in Maintenance →
          </Link>
        </div>

        {/* Tenant report link (Option B Slice 2 — tokenized tenant intake). The
            tenant uses this stable link to report issues with no account. */}
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800">Tenant reporting link</p>
              <p className="text-xs text-gray-500">
                Share this with the tenant so they can report maintenance issues
                (with photos or video) — no account needed.
              </p>
            </div>
            {t.report_token ? (
              <div className="flex shrink-0 items-center gap-2">
                <CopyLinkButton
                  path={tenantReportPath(t.report_token)}
                  label="Copy tenant link"
                />
                <Link
                  href={tenantReportPath(t.report_token)}
                  target="_blank"
                  className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                >
                  Preview →
                </Link>
              </div>
            ) : (
              <form action={generateTenantReportLink} className="shrink-0">
                <input type="hidden" name="tenancy_id" value={t.id} />
                <button
                  type="submit"
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Create reporting link
                </button>
              </form>
            )}
          </div>
          {searchParams.report === "locked" ? (
            <p className="mt-2 text-xs text-amber-700">
              Tenant reporting is available on the Growth plan and up.
            </p>
          ) : searchParams.report === "ready" && t.report_token ? (
            <p className="mt-2 text-xs text-green-700">
              Link ready — copy it and send it to your tenant.
            </p>
          ) : null}
        </div>

        {workOrders.length > 0 ? (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
            {workOrders.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">{w.title}</span>
                  <span className="ml-2 block text-xs text-gray-400">
                    {workOrderCategoryLabel(w.category)}
                    {w.trade ? ` · ${w.trade.name}` : " · Unassigned"}
                    {w.scheduled_for ? ` · scheduled ${w.scheduled_for}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="flex items-center gap-1.5">
                    <StatusChip tone={woChipTone(workOrderPriorityTone(w.priority))}>
                      {workOrderPriorityLabel(w.priority)}
                    </StatusChip>
                    <StatusChip tone={woChipTone(workOrderStatusTone(w.status))}>
                      {workOrderStatusLabel(w.status)}
                    </StatusChip>
                  </span>
                  {statusOffersTenantUpdate(w.status) && (
                    <Link
                      href={`/dashboard/tenancies/${t.id}?wo_msg=${w.status}&wo_id=${w.id}#message`}
                      className="text-xs font-medium text-brand hover:underline"
                    >
                      Tell the tenant →
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
            No maintenance logged for this unit yet.
          </p>
        )}

        {/* Report-an-issue form */}
        <form
          action={reportTenancyIssue}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4"
        >
          <input type="hidden" name="tenancy_id" value={t.id} />
          <div className="min-w-[12rem] flex-1">
            <label className={labelCls}>Issue</label>
            <input
              name="title"
              required
              placeholder="e.g. Kitchen faucet leaking"
              className={inputCls}
            />
          </div>
          <div className="w-40">
            <label className={labelCls}>Category</label>
            <select name="category" defaultValue="general" className={inputCls}>
              {WORK_ORDER_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {workOrderCategoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="w-32">
            <label className={labelCls}>Priority</label>
            <select name="priority" defaultValue="normal" className={inputCls}>
              {WORK_ORDER_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {workOrderPriorityLabel(p)}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className={labelCls}>Details (optional)</label>
            <input name="description" placeholder="Access notes, what's needed…" className={inputCls} />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            style={{ background: "var(--brand-gradient, var(--brand-color))" }}
          >
            Report issue
          </button>
        </form>
      </div>
      </CollapsibleSection>

      {/* Tenant messages (email / SMS) ----------------------------------- */}
      <CollapsibleSection
        id="message"
        title="Tenant messages"
        status={messagesStatus}
        defaultOpen={!!initialTemplateId || !!initialDetails}
      >
      <div className="mb-8 space-y-5 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-gray-600">
          Message the tenants on this tenancy by email and/or text — rent
          reminders, maintenance notices, or general updates. Messages send under
          your brand; replies come back to your reply-to address.{" "}
          <Link href="/dashboard/settings#templates" className="font-medium text-brand hover:underline">
            Manage saved templates
          </Link>
          .
        </p>

        {(initialTemplateId || initialDetails) && (
          <div className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm text-gray-700">
            A maintenance update is loaded below
            {initialDetails ? ", with this job's quote and expected dates filled in" : ""}, ready
            for you to review, fill in any remaining details in [brackets], and send.
          </div>
        )}

        {tenants.length === 0 ? (
          <p className="text-sm text-gray-500">Add a tenant above to send a message.</p>
        ) : (
          <TenantMessageComposer
            tenancyId={t.id}
            tenants={composerTenants}
            templates={templates}
            smsAllowed={smsAllowed}
            orgName={org?.name ?? null}
            propertyAddress={t.property?.address ?? null}
            rentCents={t.rent_cents}
            orgContactEmail={org?.public_contact_email ?? null}
            orgContactPhone={org?.public_contact_phone ?? null}
            initialTemplateId={initialTemplateId}
            initialDetails={initialDetails}
            sendAction={sendTenantMessage}
          />
        )}

        {/* Message history */}
        {messages.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Sent history
            </h3>
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">
              {messages.map((m) => (
                <li key={m.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900">
                        {m.subject || (m.channel === "sms" ? "Text message" : "(no subject)")}
                      </span>
                      <span className="ml-2 text-xs text-gray-400">
                        {channelLabel(m.channel)} · {new Date(m.created_at).toLocaleString()}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {m.sent_count} sent
                      {m.failed_count > 0 ? `, ${m.failed_count} failed` : ""}
                      {m.skipped_count > 0 ? `, ${m.skipped_count} skipped` : ""}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-gray-500">{m.body}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      </CollapsibleSection>

      {/* Lifecycle actions ----------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {t.status !== "ended" && (
          <form action={endTenancy}>
            <input type="hidden" name="id" value={t.id} />
            <button className={SECONDARY_ACTION_CLASS}>End tenancy</button>
          </form>
        )}
        <form action={deleteTenancy}>
          <input type="hidden" name="id" value={t.id} />
          <button className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50">
            Delete tenancy
          </button>
        </form>
        <p className="text-xs text-gray-400">
          Ending keeps the record; deleting removes it and its tenants permanently.
        </p>
      </div>
    </div>
  );
}
