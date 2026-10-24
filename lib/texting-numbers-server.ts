// S736: texting numbers without staff. Server half: Twilio's number API and
// the account rows. Rules live in lib/texting-numbers.ts (pure, tested).
// Every function here never throws; a failure is recorded on the account and
// the renters keep getting every message by email.

import type { SupabaseClient } from "@supabase/supabase-js";
import { canUseRenterSms } from "@/lib/billing";
import { sendNotificationEmail } from "@/lib/email";
import { getUserByIdCached } from "@/lib/auth-email-cache";
import { adminEmails } from "@/lib/provisioning-server";
import { cleanOwnNumber } from "@/lib/org-sms-numbers";
import { textingOnEmail } from "@/lib/texting-setup-emails";
import {
  MAX_PROVISION_ATTEMPTS,
  PROVISION_CLAIM_MS,
  numberFriendlyName,
  numberSearchPlan,
  pickBuyableNumber,
  provisionDecision,
  provisionGaveUpEmail,
  releaseDecision,
  type NumberSearchPlan,
  type TwilioAvailableNumber,
} from "@/lib/texting-numbers";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01/Accounts";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

type Admin = SupabaseClient;

function twilioAuth(): { sid: string; header: string } | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return { sid, header: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` };
}

/** The off switch: TEXTING_AUTO_NUMBERS=off sends requests back to staff. */
export function autoNumbersOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.TEXTING_AUTO_NUMBERS ?? "").trim().toLowerCase() !== "off";
}

async function searchNumbers(
  auth: { sid: string; header: string },
  query: Record<string, string>,
): Promise<TwilioAvailableNumber[]> {
  const qs = new URLSearchParams({ SmsEnabled: "true", PageSize: "20", ...query });
  const res = await fetch(
    `${TWILIO_API_BASE}/${encodeURIComponent(auth.sid)}/AvailablePhoneNumbers/CA/Local.json?${qs}`,
    { headers: { authorization: auth.header, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`twilio_search_${res.status}`);
  const json = (await res.json()) as { available_phone_numbers?: TwilioAvailableNumber[] };
  return json.available_phone_numbers ?? [];
}

/** First buyable number, trying each area code, then the province, then anywhere in Canada. */
async function findNumber(auth: { sid: string; header: string }, plan: NumberSearchPlan): Promise<string | null> {
  const tries: Record<string, string>[] = [
    ...plan.areaCodes.map((c) => ({ AreaCode: c })),
    ...(plan.region ? [{ InRegion: plan.region }] : []),
    {},
  ];
  for (const q of tries) {
    const pick = pickBuyableNumber(await searchNumbers(auth, q));
    if (pick && cleanOwnNumber(pick)) return pick;
  }
  return null;
}

async function buyNumber(
  auth: { sid: string; header: string },
  phone: string,
  friendlyName: string,
): Promise<{ sid: string; phone: string }> {
  const form = new URLSearchParams({
    PhoneNumber: phone,
    FriendlyName: friendlyName,
    SmsUrl: process.env.TWILIO_INBOUND_URL || `${APP_URL}/api/sms/inbound`,
    SmsMethod: "POST",
    VoiceUrl: process.env.TWILIO_VOICE_URL || `${APP_URL}/api/sms/voice`,
    VoiceMethod: "POST",
  });
  const res = await fetch(`${TWILIO_API_BASE}/${encodeURIComponent(auth.sid)}/IncomingPhoneNumbers.json`, {
    method: "POST",
    headers: {
      authorization: auth.header,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: form.toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`twilio_buy_${res.status}:${detail.slice(0, 160)}`);
  }
  const json = (await res.json()) as { sid?: string; phone_number?: string };
  if (!json.sid || !json.phone_number) throw new Error("twilio_buy_no_sid");
  return { sid: json.sid, phone: json.phone_number };
}

/** Release a number the app bought. True when Twilio no longer has it. */
export async function releaseTwilioNumber(twilioSid: string): Promise<boolean> {
  const auth = twilioAuth();
  if (!auth || !/^PN[0-9a-f]{32}$/i.test(twilioSid)) return false;
  try {
    const res = await fetch(
      `${TWILIO_API_BASE}/${encodeURIComponent(auth.sid)}/IncomingPhoneNumbers/${encodeURIComponent(twilioSid)}.json`,
      { method: "DELETE", headers: { authorization: auth.header }, signal: AbortSignal.timeout(8000) },
    );
    return res.status === 204 || res.status === 404;
  } catch {
    return false;
  }
}

/** "Texting is on" to the account's owner admins (moved here from the admin actions). */
export async function emailLandlordTextingOn(admin: Admin, orgId: string, phoneE164: string): Promise<void> {
  const [{ data: org }, { data: members }] = await Promise.all([
    admin.from("organizations").select("name, brand_color, logo_url").eq("id", orgId).maybeSingle(),
    admin.from("memberships").select("user_id").eq("organization_id", orgId).eq("role", "owner_admin"),
  ]);
  const o = (org ?? {}) as { name?: string | null; brand_color?: string | null; logo_url?: string | null };
  const mail = textingOnEmail({ orgName: o.name ?? null, phoneE164 });
  const seen = new Set<string>();
  for (const m of (members ?? []) as { user_id: string }[]) {
    const { data } = await getUserByIdCached(admin, m.user_id);
    const to = data.user?.email?.trim().toLowerCase();
    if (!to || seen.has(to)) continue;
    seen.add(to);
    await sendNotificationEmail({
      to_email: to,
      subject: mail.subject,
      body: mail.body,
      org_name: o.name ?? "Vacantless",
      brand_color: o.brand_color ?? null,
      logo_url: o.logo_url ?? null,
      reply_to_email: null,
    }).catch(() => null);
  }
}

export type ProvisionResult =
  | { ok: true; phone: string }
  | { ok: false; why: string };

/**
 * Buy, set up and switch on a number for one account, when the rules say so.
 * The claim (sms_provision_tried_at, set only if no try is running) stops a
 * double press or the sweep from buying a second number.
 */
export async function provisionTextingNumber(
  admin: Admin,
  orgId: string,
  opts: { fromPress: boolean; nowMs?: number },
): Promise<ProvisionResult> {
  const nowMs = opts.nowMs ?? Date.now();
  try {
    if (!autoNumbersOn()) return { ok: false, why: "auto_off" };
    const auth = twilioAuth();
    if (!auth) return { ok: false, why: "no_twilio_keys" };

    const [{ data: orgRow }, { data: numberRow }] = await Promise.all([
      admin
        .from("organizations")
        .select("id, name, plan, closed_at, sms_requested_at, sms_provision_attempts, sms_provision_tried_at")
        .eq("id", orgId)
        .maybeSingle(),
      admin.from("org_sms_numbers").select("organization_id").eq("organization_id", orgId).maybeSingle(),
    ]);
    const org = orgRow as {
      id: string;
      name: string | null;
      plan: string | null;
      closed_at: string | null;
      sms_requested_at: string | null;
      sms_provision_attempts: number | null;
      sms_provision_tried_at: string | null;
    } | null;
    if (!org) return { ok: false, why: "no_org" };

    const decision = provisionDecision({
      plan: org.plan,
      planHasTexting: canUseRenterSms(org.plan),
      closed: !!org.closed_at,
      requested: !!org.sms_requested_at,
      hasNumber: !!numberRow,
      attempts: org.sms_provision_attempts ?? 0,
      triedAtMs: org.sms_provision_tried_at ? Date.parse(org.sms_provision_tried_at) : null,
      nowMs,
      fromPress: opts.fromPress,
    });
    if (!decision.go) return { ok: false, why: decision.why };

    // Claim the try. Only one caller wins the update.
    const claimBefore = new Date(nowMs - PROVISION_CLAIM_MS).toISOString();
    const claimQuery = admin
      .from("organizations")
      .update({ sms_provision_tried_at: new Date(nowMs).toISOString() })
      .eq("id", orgId);
    const { data: claimed } = await (org.sms_provision_tried_at
      ? claimQuery.lt("sms_provision_tried_at", claimBefore)
      : claimQuery.is("sms_provision_tried_at", null)
    ).select("id");
    if (!claimed || (claimed as unknown[]).length === 0) return { ok: false, why: "in_progress" };

    const { data: props } = await admin
      .from("properties")
      .select("address")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(5);
    const plan = numberSearchPlan(((props ?? []) as { address: string | null }[]).map((p) => p.address));

    let bought: { sid: string; phone: string } | null = null;
    try {
      const phone = await findNumber(auth, plan);
      if (!phone) throw new Error("no_number_without_address");
      bought = await buyNumber(auth, phone, numberFriendlyName(org.name, orgId));
      const clean = cleanOwnNumber(bought.phone);
      if (!clean) throw new Error("bought_not_canadian");
      const write = await admin.from("org_sms_numbers").insert({
        organization_id: orgId,
        phone_e164: clean,
        provider: "twilio",
        enabled: true,
        twilio_sid: bought.sid,
        updated_at: new Date(nowMs).toISOString(),
        updated_by: "auto",
      });
      if (write.error) throw new Error(`save_${write.error.code ?? "failed"}`);
      await admin
        .from("organizations")
        .update({ sms_requested_at: null, sms_enabled: true, sms_provision_attempts: 0, sms_provision_error: null })
        .eq("id", orgId);
      await emailLandlordTextingOn(admin, orgId, clean).catch(() => null);
      return { ok: true, phone: clean };
    } catch (e) {
      // A number we paid for but could not save is released at once.
      if (bought) await releaseTwilioNumber(bought.sid);
      const error = String((e as Error)?.message ?? e).slice(0, 200);
      const attempts = (org.sms_provision_attempts ?? 0) + 1;
      await admin
        .from("organizations")
        .update({ sms_provision_attempts: attempts, sms_provision_error: error })
        .eq("id", orgId);
      if (attempts === MAX_PROVISION_ATTEMPTS) {
        const mail = provisionGaveUpEmail({ orgName: org.name, orgId, lastError: error, plan });
        for (const to of adminEmails()) {
          await sendNotificationEmail({
            to_email: to,
            subject: mail.subject,
            body: mail.body,
            org_name: "Vacantless",
            brand_color: null,
            logo_url: null,
            reply_to_email: null,
          }).catch(() => null);
        }
      }
      console.error("[texting-numbers] buy failed", orgId, error);
      return { ok: false, why: error };
    }
  } catch (e) {
    console.error("[texting-numbers] provision crashed", orgId, (e as Error)?.message);
    return { ok: false, why: "crashed" };
  }
}

export type SweepOutcome = { bought: number; released: number; marked: number; failed: number };

/** The 15-minute sweep: retry waiting requests, then release numbers no one pays for. */
export async function sweepTextingNumbers(admin: Admin, nowMs = Date.now()): Promise<SweepOutcome> {
  const out: SweepOutcome = { bought: 0, released: 0, marked: 0, failed: 0 };

  // 1. Waiting requests (a failed press, or a press while Twilio was down).
  const { data: waiting } = await admin
    .from("organizations")
    .select("id")
    .not("sms_requested_at", "is", null)
    .is("closed_at", null)
    .lt("sms_provision_attempts", MAX_PROVISION_ATTEMPTS)
    .limit(5);
  for (const o of (waiting ?? []) as { id: string }[]) {
    const r = await provisionTextingNumber(admin, o.id, { fromPress: false, nowMs });
    if (r.ok) out.bought++;
    else if (!["too_soon", "in_progress", "has_number", "no_texting_on_plan", "not_requested", "auto_off"].includes(r.why)) out.failed++;
  }

  // 2. Numbers the app bought, against their account's plan.
  const { data: rows } = await admin
    .from("org_sms_numbers")
    .select("organization_id, twilio_sid, lapsed_since, organization:organizations(plan, closed_at)")
    .not("twilio_sid", "is", null)
    .limit(200);
  for (const row of (rows ?? []) as unknown as {
    organization_id: string;
    twilio_sid: string;
    lapsed_since: string | null;
    organization: { plan: string | null; closed_at: string | null } | null;
  }[]) {
    const d = releaseDecision({
      boughtByApp: true,
      planHasTexting: canUseRenterSms(row.organization?.plan ?? null),
      closed: !!row.organization?.closed_at,
      lapsedSinceMs: row.lapsed_since ? Date.parse(row.lapsed_since) : null,
      nowMs,
    });
    if (d === "mark_lapsed") {
      await admin.from("org_sms_numbers").update({ lapsed_since: new Date(nowMs).toISOString() }).eq("organization_id", row.organization_id);
      out.marked++;
    } else if (d === "clear_lapsed") {
      await admin.from("org_sms_numbers").update({ lapsed_since: null }).eq("organization_id", row.organization_id);
    } else if (d === "release") {
      if (await releaseTwilioNumber(row.twilio_sid)) {
        await admin.from("org_sms_numbers").delete().eq("organization_id", row.organization_id);
        out.released++;
      } else {
        out.failed++;
      }
    }
  }
  return out;
}
