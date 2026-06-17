import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyInbound, normalizePhoneE164, verifyTwilioSignature } from "@/lib/sms";

// Twilio inbound-SMS webhook. Honors opt-out: a renter who texts STOP (or
// UNSUBSCRIBE/CANCEL/etc.) is suppressed from all future Vacantless SMS by
// setting leads.sms_opt_out; START/YES re-enables them. This is our own
// second-layer suppression — Twilio's Advanced Opt-Out (enabled by default on a
// Messaging Service) already blocks the number at the carrier level and sends
// the standard confirmation, so we respond with EMPTY TwiML (no app-generated
// reply) to avoid a duplicate text, and just record the state here.
//
// Security: every request is verified against X-Twilio-Signature using the
// account's auth token (HMAC-SHA1 over the webhook URL + sorted POST params).
// If TWILIO_AUTH_TOKEN is unset we cannot verify, so we refuse to act (200
// no-op, so Twilio doesn't retry-storm). Set TWILIO_INBOUND_URL in Vercel to the
// exact public webhook URL if the auto-reconstructed URL ever fails to match
// (proxies can rewrite host/proto).
//
// Configure in the Twilio console: Messaging Service (or number) "A message
// comes in" webhook -> POST https://<app>/api/sms/inbound

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twiml(body = EMPTY_TWIML, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    // Can't validate the request -> don't act. 200 so Twilio won't retry.
    return twiml();
  }

  // Twilio posts application/x-www-form-urlencoded.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return twiml(EMPTY_TWIML, 400);
  }

  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  // Reconstruct the URL Twilio signed. Prefer an explicit override.
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const url =
    process.env.TWILIO_INBOUND_URL || `${proto}://${host}${new URL(req.url).pathname}`;

  const signature = req.headers.get("x-twilio-signature");
  if (!verifyTwilioSignature(token, url, params, signature)) {
    return twiml(EMPTY_TWIML, 403);
  }

  const from = params.From ?? "";
  const action = classifyInbound(params.Body ?? "");
  if (!action) {
    // A normal renter reply — not an opt-out/in keyword. We don't auto-respond;
    // the operator handles real conversations. Acknowledge with empty TwiML.
    return twiml();
  }

  const admin = createAdminClient();
  if (!admin) return twiml(); // not configured -> acknowledge, do nothing

  // Find every lead whose number resolves to the sender's, matched in SQL on
  // the normalized leads.phone_e164 column (migration 0023). This honors a STOP
  // across ALL of the sender's leads with no row cap (a STOP must never be
  // silently dropped) - the old free-text JS scan was capped at 2000.
  const senderE164 = normalizePhoneE164(from);
  if (!senderE164) return twiml(); // unparseable sender -> nothing to match

  const { data: leads } = await admin
    .from("leads")
    .select("id, organization_id, sms_opt_out")
    .eq("phone_e164", senderE164);

  // NB: do NOT early-return on zero lead matches — the sender may be a TENANT
  // and not a lead (the tenant block below must still run).
  const matches = leads ?? [];

  const optOut = action === "stop";
  const ids = matches
    .filter((l: any) => Boolean(l.sms_opt_out) !== optOut) // only those that change
    .map((l: any) => l.id);

  if (ids.length > 0) {
    await admin
      .from("leads")
      .update({
        sms_opt_out: optOut,
        sms_opt_out_at: optOut ? new Date().toISOString() : null,
      })
      .in("id", ids);

    // Log the inbound on each affected lead's timeline.
    const rows = matches
      .filter((l: any) => ids.includes(l.id))
      .map((l: any) => ({
        organization_id: l.organization_id,
        lead_id: l.id,
        channel: "sms",
        direction: "inbound",
        body: optOut
          ? `Renter texted ${(params.Body ?? "").trim().toUpperCase().split(/\s+/)[0] || "STOP"} — opted out of SMS`
          : "Renter texted START — opted back in to SMS",
      }));
    if (rows.length > 0) await admin.from("messages").insert(rows);
  }

  // Also honor the opt-out across TENANTS whose number resolves to the sender
  // (platform pivot step 3 — tenant comms). Same SQL match on the normalized
  // tenants.phone_e164 column (migration 0034), no row cap so a STOP is never
  // dropped. Tenants have no per-record message timeline, so we just flip the
  // flag + timestamp; the tenant-message send path already skips opted-out
  // tenants (lib/tenant-comms planDeliveries).
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, sms_opt_out")
    .eq("phone_e164", senderE164);

  const tenantMatches = tenants ?? [];
  const tenantIds = tenantMatches
    .filter((t: any) => Boolean(t.sms_opt_out) !== optOut) // only those that change
    .map((t: any) => t.id);

  if (tenantIds.length > 0) {
    await admin
      .from("tenants")
      .update({
        sms_opt_out: optOut,
        sms_opt_out_at: optOut ? new Date().toISOString() : null,
      })
      .in("id", tenantIds);
  }

  // Rely on Twilio's built-in opt-out confirmation; send no second message.
  return twiml();
}
