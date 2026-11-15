// Server-only: Rotessa rent on a tenancy (S798). Link an existing customer by
// email, read the payment summary, stop rent now (delete the schedule),
// schedule a last-payment stop, and archive the customer when a tenancy ends.
// Pure decisions live in lib/rotessa-rent-plan.ts.
//
// NEVER import this into a client component.

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import { normalizeEnvironment, rotessaAuthHeader, rotessaBaseUrl, type RotessaEnvironment } from "@/lib/rotessa";
import {
  parseCustomer,
  parseCustomerList,
  summarizeRotessaRent,
  decideRotessaScheduledStop,
  pickCustomerByEmail,
  scheduleToLink,
  type RotessaCustomerDetail,
  type RotessaRentSummary,
} from "@/lib/rotessa-rent-plan";
import { upcomingChargeDates } from "@/lib/stripe-connect";

export type RotessaConn = { apiKey: string; environment: RotessaEnvironment };

type Resp = { status: number; json: unknown; error?: string };

async function rotessaRequest(
  conn: RotessaConn,
  method: "GET" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Resp> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${rotessaBaseUrl(conn.environment)}${path}`, {
      method,
      headers: {
        Authorization: rotessaAuthHeader(conn.apiKey),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { status: 0, json: null, error: aborted ? "Rotessa did not respond in time." : "Could not reach Rotessa." };
  } finally {
    clearTimeout(timer);
  }
}

function ok2xx(r: Resp): boolean {
  return r.status >= 200 && r.status < 300;
}

function errText(r: Resp): string {
  if (r.error) return r.error;
  const o = r.json && typeof r.json === "object" ? (r.json as Record<string, unknown>) : {};
  const errs = Array.isArray(o.errors) ? o.errors : [];
  const msg = errs
    .map((e) => (e && typeof e === "object" ? String((e as Record<string, unknown>).error_message ?? "") : String(e)))
    .filter(Boolean)
    .join("; ");
  return (msg || `Rotessa answered ${r.status}`).slice(0, 300);
}

/** The org's Rotessa connection, decrypted. null if not connected. */
export async function loadRotessaConn(supabase: SupabaseClient, orgId: string): Promise<RotessaConn | null> {
  const { data } = await supabase
    .from("rotessa_accounts")
    .select("api_key_encrypted, environment")
    .eq("organization_id", orgId)
    .limit(1);
  const row = data?.[0] as { api_key_encrypted: string | null; environment: string } | undefined;
  if (!row?.api_key_encrypted) return null;
  try {
    return { apiKey: decryptSecret(row.api_key_encrypted), environment: normalizeEnvironment(row.environment) };
  } catch {
    return null;
  }
}

export async function listRotessaCustomers(conn: RotessaConn): Promise<RotessaCustomerDetail[] | null> {
  const r = await rotessaRequest(conn, "GET", "/customers");
  return ok2xx(r) ? parseCustomerList(r.json) : null;
}

export async function getRotessaCustomer(conn: RotessaConn, customerId: string): Promise<RotessaCustomerDetail | null> {
  const r = await rotessaRequest(conn, "GET", `/customers/${encodeURIComponent(customerId)}`);
  return ok2xx(r) ? parseCustomer(r.json) : null;
}

/** Live payment summary for a tenancy's Rotessa schedule. null on any failure. */
export async function fetchRotessaRentSummary(
  conn: RotessaConn | null,
  customerId: string | null | undefined,
  scheduleId: string | null | undefined,
): Promise<(RotessaRentSummary & { customerActive: boolean }) | null> {
  if (!conn || !customerId) return null;
  const c = await getRotessaCustomer(conn, customerId);
  if (!c) return null;
  return { ...summarizeRotessaRent(c, scheduleId ?? null), customerActive: c.active };
}

export type RotessaOpResult = { ok: true; changed: boolean } | { ok: false; reason: string };

/**
 * Delete a transaction schedule. A schedule that no longer exists counts as
 * done. Verifies with a read of the customer when the delete is refused.
 */
export async function deleteRotessaSchedule(
  conn: RotessaConn,
  customerId: string,
  scheduleId: string,
): Promise<RotessaOpResult> {
  const r = await rotessaRequest(conn, "DELETE", `/transaction_schedules/${encodeURIComponent(scheduleId)}`);
  if (ok2xx(r)) return { ok: true, changed: true };
  const c = await getRotessaCustomer(conn, customerId);
  if (c && !c.schedules.some((s) => s.id === scheduleId)) return { ok: true, changed: false };
  return { ok: false, reason: errText(r) };
}

/** Archive (active:false) a customer. Verified by reading it back. */
export async function archiveRotessaCustomer(conn: RotessaConn, customerId: string): Promise<RotessaOpResult> {
  const before = await getRotessaCustomer(conn, customerId);
  if (before && !before.active) return { ok: true, changed: false };
  const r = await rotessaRequest(conn, "PATCH", `/customers/${encodeURIComponent(customerId)}`, { active: false });
  const after = await getRotessaCustomer(conn, customerId);
  if (after && !after.active) return { ok: true, changed: true };
  return { ok: false, reason: ok2xx(r) ? "Rotessa did not archive the customer." : errText(r) };
}

type RotessaRow = {
  id: string;
  status: string | null;
  rotessa_customer_id: string | null;
  rotessa_schedule_id: string | null;
};

async function loadRow(supabase: SupabaseClient, tenancyId: string): Promise<RotessaRow | null> {
  const { data } = await supabase
    .from("tenancies")
    .select("id, status, rotessa_customer_id, rotessa_schedule_id")
    .eq("id", tenancyId)
    .maybeSingle();
  return (data as RotessaRow | null) ?? null;
}

export type StopRotessaResult =
  | { ok: true; stopped: boolean; archived: boolean }
  | { ok: false; code: "notconnected" | "stopfail" | "archivefail"; reason?: string };

/**
 * Stop Rotessa rent on a tenancy right away: delete the schedule, clear it on
 * the tenancy, and (when archive is true, i.e. the tenancy is ending) archive
 * the customer so nothing new can be scheduled. Nothing to stop = ok.
 */
export async function stopTenancyRotessaRent(
  supabase: SupabaseClient,
  orgId: string,
  tenancyId: string,
  opts: { archive: boolean },
): Promise<StopRotessaResult> {
  const row = await loadRow(supabase, tenancyId);
  if (!row?.rotessa_customer_id) return { ok: true, stopped: false, archived: false };
  if (!row.rotessa_schedule_id && !opts.archive) return { ok: true, stopped: false, archived: false };
  const conn = await loadRotessaConn(supabase, orgId);
  if (!conn) return { ok: false, code: "notconnected" };

  let stopped = false;
  if (row.rotessa_schedule_id) {
    const del = await deleteRotessaSchedule(conn, row.rotessa_customer_id, row.rotessa_schedule_id);
    if (!del.ok) {
      console.error("[rotessa-rent] schedule delete failed:", del.reason);
      return { ok: false, code: "stopfail", reason: del.reason };
    }
    stopped = true;
    const now = new Date().toISOString();
    await supabase
      .from("tenancies")
      .update({ rotessa_schedule_id: null, rotessa_schedule_synced_at: now, rent_stop_after: null, updated_at: now })
      .eq("id", tenancyId);
  }

  let archived = false;
  if (opts.archive) {
    const arc = await archiveRotessaCustomer(conn, row.rotessa_customer_id);
    if (!arc.ok) {
      console.error("[rotessa-rent] archive failed:", arc.reason);
      return { ok: false, code: "archivefail", reason: arc.reason };
    }
    archived = true;
  }
  return { ok: true, stopped, archived };
}

export type ScheduleRotessaStopResult =
  | { ok: true; dateIso: string }
  | { ok: false; code: "nolive" | "notconnected" | "nonext" | "badlastdate" };

/** Upcoming Rotessa payment dates the landlord may pick as the last one. */
export function rotessaLastPaymentOptions(summary: RotessaRentSummary | null, count = 12): string[] {
  if (!summary?.scheduleFound) return [];
  return upcomingChargeDates(summary.nextChargeIso, summary.anchorDay, count);
}

/**
 * Store rent_stop_after for a Rotessa schedule. The date must be one of the
 * schedule's upcoming payment dates (read from Rotessa, never trusted from the
 * form). Nothing changes at Rotessa now; the rent-stop sweep deletes the
 * schedule once that payment has been taken.
 */
export async function scheduleTenancyRotessaStop(
  supabase: SupabaseClient,
  orgId: string,
  tenancyId: string,
  chosenIso?: string | null,
): Promise<ScheduleRotessaStopResult> {
  const row = await loadRow(supabase, tenancyId);
  if (!row?.rotessa_customer_id || !row.rotessa_schedule_id) return { ok: false, code: "nolive" };
  const conn = await loadRotessaConn(supabase, orgId);
  if (!conn) return { ok: false, code: "notconnected" };
  const summary = await fetchRotessaRentSummary(conn, row.rotessa_customer_id, row.rotessa_schedule_id);
  if (!summary?.scheduleFound || !summary.nextChargeIso) return { ok: false, code: "nonext" };
  const wanted = (chosenIso ?? "").trim() || summary.nextChargeIso;
  if (!rotessaLastPaymentOptions(summary, 24).includes(wanted)) return { ok: false, code: "badlastdate" };
  const { error } = await supabase
    .from("tenancies")
    .update({ rent_stop_after: wanted, updated_at: new Date().toISOString() })
    .eq("id", tenancyId);
  if (error) return { ok: false, code: "nonext" };
  return { ok: true, dateIso: wanted };
}

/**
 * Sweep step for one tenancy whose rent runs on Rotessa (called by
 * runScheduledRentStops). Deletes the schedule once the last payment has been
 * taken; archives the customer too when the tenancy has ended.
 */
export async function runRotessaScheduledStop(
  admin: SupabaseClient,
  row: { id: string; organization_id: string; rent_stop_after: string; status: string | null; rotessa_customer_id: string | null; rotessa_schedule_id: string | null },
  todayIso: string,
): Promise<"stopped" | "waiting" | "cleared" | "failed"> {
  if (!row.rotessa_customer_id || !row.rotessa_schedule_id) {
    await admin.from("tenancies").update({ rent_stop_after: null }).eq("id", row.id);
    return "cleared";
  }
  const conn = await loadRotessaConn(admin, row.organization_id);
  if (!conn) return "failed";
  const summary = await fetchRotessaRentSummary(conn, row.rotessa_customer_id, row.rotessa_schedule_id);
  if (!summary) return "failed"; // could not read Rotessa: try again next run
  const decision = decideRotessaScheduledStop({
    stopAfterIso: row.rent_stop_after,
    todayIso,
    nextChargeIso: summary.nextChargeIso,
    scheduleFound: summary.scheduleFound,
  });
  if (!decision.stop) return "waiting";
  const result = await stopTenancyRotessaRent(admin, row.organization_id, row.id, { archive: row.status === "ended" });
  if (result.ok) {
    console.log("[rent-stop] rotessa stopped", row.id, decision.reason);
    return "stopped";
  }
  console.error("[rent-stop] rotessa stop failed", row.id, result.code, result.reason ?? "");
  return "failed";
}

/**
 * Link an existing Rotessa customer to a tenancy by email (GET only at
 * Rotessa). Links its schedule too when it has exactly one.
 */
export type LinkResult =
  | { ok: true; customerId: string; scheduleId: string | null }
  | { ok: false; code: "notconnected" | "listfail" | "bademail" | "nomatch" | "many" | "archived" | "taken" };

export async function linkRotessaCustomerByEmail(
  supabase: SupabaseClient,
  orgId: string,
  tenancyId: string,
  email: string,
): Promise<LinkResult> {
  const conn = await loadRotessaConn(supabase, orgId);
  if (!conn) return { ok: false, code: "notconnected" };
  const list = await listRotessaCustomers(conn);
  if (!list) return { ok: false, code: "listfail" };
  const pick = pickCustomerByEmail(list, email);
  if (!pick.ok) return { ok: false, code: pick.code };
  // GET /customers may omit schedules; read the one customer in full.
  const full = (await getRotessaCustomer(conn, pick.customer.id)) ?? pick.customer;

  // Never link one Rotessa customer to two tenancies in this org.
  const { data: other } = await supabase
    .from("tenancies")
    .select("id")
    .eq("organization_id", orgId)
    .eq("rotessa_customer_id", full.id)
    .neq("id", tenancyId)
    .limit(1);
  if (other && other.length > 0) return { ok: false, code: "taken" };

  const scheduleId = scheduleToLink(full);
  const now = new Date().toISOString();
  await supabase
    .from("tenancies")
    .update({
      rotessa_customer_id: full.id,
      rotessa_customer_synced_at: now,
      rotessa_schedule_id: scheduleId,
      rotessa_schedule_synced_at: scheduleId ? now : null,
      updated_at: now,
    })
    .eq("id", tenancyId);
  return { ok: true, customerId: full.id, scheduleId };
}
