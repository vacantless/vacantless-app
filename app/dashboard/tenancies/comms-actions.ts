"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  isMessageChannel,
  validateMessageInput,
  type MessageChannel,
} from "@/lib/tenant-comms";
import { canUseSms } from "@/lib/billing";
import { dispatchTenantMessage } from "@/lib/tenant-comms-dispatch";
import {
  UNDO_WINDOW_SECONDS,
  tenantCommsOutboxEnabled,
  validateScheduledSendAt,
} from "@/lib/tenant-comms-schedule";

// Send a landlord -> tenant message (platform pivot step 3). Guarded on
// manage_tenancies (the post-lease property-management capability, same as the
// rest of the tenancy CRUD + the manual payment ledger). REDIRECT-based (the
// S170 revalidate-503 WATCH). The fan-out/logging core now lives in
// lib/tenant-comms-dispatch so inline sends and outbox dispatch cannot drift.

const BASE = "/dashboard/tenancies";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function tenancyPath(id: string): string {
  return `${BASE}/${id}`;
}

function outcomeFor(result: { sent: number; failed: number }): "sent" | "failed" | "noone" {
  return result.sent > 0 ? "sent" : result.failed > 0 ? "failed" : "noone";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
}

type SupabaseClientLike = {
  from: (table: string) => any;
};

type SelectedMessageInput = {
  tenancyId: string;
  channel: string;
  subject: string | null;
  body: string;
  recipientIds: string[];
};

type ValidSelectedMessage = {
  channel: MessageChannel;
  subject: string | null;
  body: string;
  recipientIds: string[];
};

async function validateSelectedMessage(args: {
  supabase: SupabaseClientLike;
  orgId: string;
  orgPlan: string;
  input: SelectedMessageInput;
}): Promise<
  | { ok: true; value: ValidSelectedMessage }
  | { ok: false; code: string; notFound?: boolean }
> {
  const { supabase, orgId, orgPlan, input } = args;

  const { data } = await supabase
    .from("tenancies")
    .select("id, tenants(id)")
    .eq("id", input.tenancyId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!data) return { ok: false, code: "notfound", notFound: true };

  const tenantIds = new Set(
    (((data as { tenants?: { id: string | null }[] | null }).tenants ?? [])
      .map((t) => t.id)
      .filter((id): id is string => !!id)),
  );
  const seen = new Set<string>();
  const recipientIds = input.recipientIds.filter((id) => {
    if (!tenantIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const check = validateMessageInput({
    channel: input.channel,
    subject: input.subject,
    body: input.body,
    recipientCount: recipientIds.length,
  });
  if (!check.ok) return { ok: false, code: check.code };

  if (check.value.channel === "sms" && !canUseSms(orgPlan)) {
    return { ok: false, code: "sms_locked" };
  }

  return {
    ok: true,
    value: {
      channel: check.value.channel,
      subject: check.value.subject,
      body: check.value.body,
      recipientIds,
    },
  };
}

export async function sendTenantMessage(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect(BASE);
  await requireCapability("manage_tenancies", `${tenancyPath(tenancyId)}?msg=forbidden`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  const selectedRaw = formData.getAll("recipient_ids").map((v) => String(v));
  const validated = await validateSelectedMessage({
    supabase,
    orgId: org.id,
    orgPlan: org.plan,
    input: {
      tenancyId,
      channel: s(formData, "channel"),
      subject: s(formData, "subject") || null,
      body: s(formData, "body"),
      recipientIds: selectedRaw,
    },
  });
  if (!validated.ok) {
    if (validated.notFound) redirect(BASE);
    redirect(`${tenancyPath(tenancyId)}?msg=${validated.code}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sendMode = s(formData, "send_mode") || "now";
  if (tenantCommsOutboxEnabled() && sendMode === "later") {
    const scheduled = validateScheduledSendAt(s(formData, "scheduled_send_at"), Date.now());
    if (!scheduled.ok) {
      redirect(`${tenancyPath(tenancyId)}?msg=schedule_invalid`);
    }

    const { error } = await supabase.from("scheduled_tenant_messages").insert({
      organization_id: org.id,
      tenancy_id: tenancyId,
      channel: validated.value.channel,
      subject: validated.value.subject,
      body: validated.value.body,
      recipient_ids: validated.value.recipientIds,
      scheduled_send_at: new Date(scheduled.value.atMs).toISOString(),
      status: "scheduled",
      origin: "scheduled",
      created_by: user?.id ?? null,
    });
    if (error) redirect(`${tenancyPath(tenancyId)}?msg=schedule_failed`);

    revalidatePath(tenancyPath(tenancyId));
    redirect(`${tenancyPath(tenancyId)}?msg=scheduled`);
  }

  const result = await dispatchTenantMessage({
    supabase,
    org,
    tenancyId,
    channel: validated.value.channel,
    subject: validated.value.subject,
    body: validated.value.body,
    recipientIds: validated.value.recipientIds,
    sentBy: user?.id ?? null,
  });

  revalidatePath(tenancyPath(tenancyId));
  const outcome = outcomeFor(result);
  redirect(
    `${tenancyPath(tenancyId)}?msg=${outcome}&s=${result.sent}&k=${result.skipped}&f=${result.failed}`,
  );
}

export type TenantMessageUndoPayload = {
  tenancyId: string;
  channel: string;
  subject: string | null;
  body: string;
  recipientIds: string[];
};

export type EnqueueTenantMessageForUndoResult =
  | { ok: true; id: string }
  | { ok: false; code: string };

export async function enqueueTenantMessageForUndo(
  payload: TenantMessageUndoPayload,
): Promise<EnqueueTenantMessageForUndoResult> {
  if (!tenantCommsOutboxEnabled()) return { ok: false, code: "disabled" };

  const tenancyId = clean(payload?.tenancyId);
  if (!tenancyId) return { ok: false, code: "notfound" };
  await requireCapability("manage_tenancies", `${tenancyPath(tenancyId)}?msg=forbidden`);

  const org = await getCurrentOrg();
  if (!org) return { ok: false, code: "notfound" };

  const supabase = createClient();
  const validated = await validateSelectedMessage({
    supabase,
    orgId: org.id,
    orgPlan: org.plan,
    input: {
      tenancyId,
      channel: clean(payload.channel),
      subject: clean(payload.subject) || null,
      body: clean(payload.body),
      recipientIds: Array.isArray(payload.recipientIds)
        ? payload.recipientIds.map(clean).filter(Boolean)
        : [],
    },
  });
  if (!validated.ok) return { ok: false, code: validated.code };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const scheduledAt = new Date(Date.now() + UNDO_WINDOW_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from("scheduled_tenant_messages")
    .insert({
      organization_id: org.id,
      tenancy_id: tenancyId,
      channel: validated.value.channel,
      subject: validated.value.subject,
      body: validated.value.body,
      recipient_ids: validated.value.recipientIds,
      scheduled_send_at: scheduledAt,
      status: "scheduled",
      origin: "undo",
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  const id = (data as { id?: string } | null)?.id ?? null;
  if (error || !id) return { ok: false, code: "schedule_failed" };
  return { ok: true, id };
}

type ScheduledTenantMessageRow = {
  id: string;
  organization_id: string;
  tenancy_id: string;
  channel: string;
  subject: string | null;
  body: string;
  recipient_ids: string[] | null;
  created_by: string | null;
  attempts: number | null;
};

export type FlushScheduledTenantMessageResult = {
  ok: boolean;
  outcome: "sent" | "failed" | "noone" | "already" | "disabled";
  messageId?: string | null;
  sent?: number;
  failed?: number;
  skipped?: number;
};

export async function flushScheduledTenantMessage(
  id: string,
): Promise<FlushScheduledTenantMessageResult> {
  if (!tenantCommsOutboxEnabled()) return { ok: false, outcome: "disabled" };

  const cleanId = clean(id);
  if (!cleanId) return { ok: true, outcome: "already" };

  await requireCapability("manage_tenancies");
  const org = await getCurrentOrg();
  if (!org) return { ok: false, outcome: "failed" };

  const supabase = createClient();
  const { data: claimed, error: claimError } = await supabase
    .from("scheduled_tenant_messages")
    .update({ status: "sending" })
    .eq("id", cleanId)
    .eq("organization_id", org.id)
    .eq("status", "scheduled")
    .lte("scheduled_send_at", new Date().toISOString())
    .select("id, organization_id, tenancy_id, channel, subject, body, recipient_ids, created_by, attempts")
    .maybeSingle();

  if (claimError) return { ok: false, outcome: "failed" };
  const row = claimed as ScheduledTenantMessageRow | null;
  if (!row) return { ok: true, outcome: "already" };

  try {
    if (!isMessageChannel(row.channel)) throw new Error("bad_channel");
    const result = await dispatchTenantMessage({
      supabase,
      org,
      tenancyId: row.tenancy_id,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      recipientIds: row.recipient_ids ?? [],
      sentBy: row.created_by,
    });
    if (!result.ok) throw new Error("dispatch_failed");

    await supabase
      .from("scheduled_tenant_messages")
      .update({
        status: "sent",
        sent_message_id: result.messageId,
        dispatched_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", row.id)
      .eq("organization_id", org.id);

    revalidatePath(tenancyPath(row.tenancy_id));
    return {
      ok: true,
      outcome: outcomeFor(result),
      messageId: result.messageId,
      sent: result.sent,
      failed: result.failed,
      skipped: result.skipped,
    };
  } catch (error) {
    await supabase
      .from("scheduled_tenant_messages")
      .update({
        status: "failed",
        error: errorText(error),
        attempts: (row.attempts ?? 0) + 1,
      })
      .eq("id", row.id)
      .eq("organization_id", org.id);
    revalidatePath(tenancyPath(row.tenancy_id));
    return { ok: false, outcome: "failed" };
  }
}

export async function cancelScheduledTenantMessage(
  id: string,
): Promise<{ ok: boolean; canceled: boolean }> {
  if (!tenantCommsOutboxEnabled()) return { ok: false, canceled: false };

  const cleanId = clean(id);
  if (!cleanId) return { ok: true, canceled: false };

  await requireCapability("manage_tenancies");
  const org = await getCurrentOrg();
  if (!org) return { ok: false, canceled: false };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("scheduled_tenant_messages")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", cleanId)
    .eq("organization_id", org.id)
    .eq("status", "scheduled")
    .select("id, tenancy_id")
    .maybeSingle();

  const row = data as { id: string; tenancy_id: string } | null;
  if (row?.tenancy_id) revalidatePath(tenancyPath(row.tenancy_id));
  return { ok: !error, canceled: !!row };
}
