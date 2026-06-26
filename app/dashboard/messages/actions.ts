"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  getNotificationEvent,
  resolveNotificationAccent,
  resolveNotificationRecipients,
  type NotificationSettingRow,
} from "@/lib/notifications";
import { sendNotificationEmail } from "@/lib/email";
import {
  validateTenantMessageEdit,
  canApproveTenantMessage,
  canDismissTenantMessage,
  type PendingMessageStatus,
} from "@/lib/tenant-message-approvals";

// Server actions for the APPROVAL-GATED tenant message queue (S341 — the
// "approve_to_send" send-mode tier). A drip step (today: the rent-increase
// courtesy note) drafted a row into pending_tenant_messages; here the operator
// edits + Approves & Sends it (the ONLY path a tenant ever receives it) or
// Dismisses it. RLS scopes every read/write to the operator's org; the pure
// guards (lib/tenant-message-approvals) keep the status machine one-way.

const BASE = "/dashboard/messages";
const FORBIDDEN = `${BASE}?forbidden=1`;

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

type PendingRow = {
  id: string;
  organization_id: string;
  event_key: string;
  status: PendingMessageStatus;
  tenant_name: string | null;
  tenant_email: string | null;
  subject: string;
  body: string;
};

/**
 * Approve & Send: persist the operator's (possibly edited) copy, send it to the
 * tenant through the branded notification rail, then flip the row to sent. The
 * STORED copy is what goes out — so an inline edit is real. Idempotent on a
 * non-pending row (canApprove gates it).
 */
export async function approveAndSendPendingMessage(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id");
  if (!id) redirect(`${BASE}?msg=not_found`);

  // The operator may have edited the draft in the textarea before approving.
  const edit = validateTenantMessageEdit({
    subject: s(formData, "subject"),
    body: s(formData, "body"),
  });
  if (!edit.ok) redirect(`${BASE}?msg=${edit.code}`);

  const supabase = createClient();

  // RLS scopes this to the operator's org; the explicit eq is a belt-and-braces.
  const { data: row } = await supabase
    .from("pending_tenant_messages")
    .select("id, organization_id, event_key, status, tenant_name, tenant_email, subject, body")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  const pending = (row as PendingRow | null) ?? null;
  if (!pending) redirect(`${BASE}?msg=not_found`);

  // Guard against a sent/dismissed row or a missing tenant address.
  if (
    !canApproveTenantMessage({
      status: pending.status,
      tenant_email: pending.tenant_email,
      subject: edit.value.subject,
      body: edit.value.body,
    })
  ) {
    redirect(`${BASE}?msg=cannot_send`);
  }

  // The event (for audience + accent default) and the org override (cc + accent).
  const event = getNotificationEvent(pending.event_key);
  const { data: settingRow } = await supabase
    .from("notification_settings")
    .select("event_key, enabled, subject_template, body_template, recipients, accent_color")
    .eq("organization_id", org.id)
    .eq("event_key", pending.event_key)
    .maybeSingle();
  const setting = (settingRow as NotificationSettingRow | null) ?? null;

  const recipients = resolveNotificationRecipients({
    audience: event?.audience ?? "tenant",
    configured: setting?.recipients ?? [],
    audienceEmail: pending.tenant_email,
  });
  if (recipients.length === 0) redirect(`${BASE}?msg=cannot_send`);

  const accent = event ? resolveNotificationAccent(event, setting) : null;

  // Send the STORED (edited) copy. Best-effort per recipient — the tenant is the
  // natural audience; any org cc is additive.
  const results = await Promise.allSettled(
    recipients.map((to) =>
      sendNotificationEmail({
        to_email: to,
        subject: edit.value.subject,
        body: edit.value.body,
        action_label: null,
        action_url: null,
        org_name: org.name,
        brand_color: org.brand_color,
        accent_color: accent,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      }),
    ),
  );
  const anySent = results.some((r) => r.status === "fulfilled" && r.value.sent);
  if (!anySent) {
    // Don't burn the draft on a transient mail failure — leave it pending so the
    // operator can retry. Surface the reason.
    redirect(`${BASE}?msg=send_failed`);
  }

  const { data: auth } = await supabase.auth.getUser();
  const now = new Date().toISOString();
  await supabase
    .from("pending_tenant_messages")
    .update({
      subject: edit.value.subject,
      body: edit.value.body,
      status: "sent",
      approved_at: now,
      sent_at: now,
      decided_by: auth?.user?.id ?? null,
    })
    .eq("id", pending.id)
    .eq("organization_id", org.id)
    .eq("status", "pending"); // concurrency guard: only a still-pending row flips

  revalidatePath(BASE);
  redirect(`${BASE}?msg=sent`);
}

/** Dismiss a queued draft so it never sends. One-way; pending rows only. */
export async function dismissPendingMessage(formData: FormData) {
  await requireCapability("manage_tenancies", FORBIDDEN);
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const id = s(formData, "id");
  if (!id) redirect(`${BASE}?msg=not_found`);

  const supabase = createClient();
  const { data: row } = await supabase
    .from("pending_tenant_messages")
    .select("id, status")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  const pending = (row as { id: string; status: PendingMessageStatus } | null) ?? null;
  if (!pending || !canDismissTenantMessage({ status: pending.status, tenant_email: null, subject: "x", body: "x" })) {
    redirect(`${BASE}?msg=cannot_dismiss`);
  }

  const { data: auth } = await supabase.auth.getUser();
  await supabase
    .from("pending_tenant_messages")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      decided_by: auth?.user?.id ?? null,
    })
    .eq("id", pending.id)
    .eq("organization_id", org.id)
    .eq("status", "pending");

  revalidatePath(BASE);
  redirect(`${BASE}?msg=dismissed`);
}
