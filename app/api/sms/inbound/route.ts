import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTwilioSignature } from "@/lib/sms";
import { applyInboundSms } from "@/lib/sms-inbound";

// Twilio inbound-SMS webhook. Honors opt-out: a renter who texts STOP (or
// UNSUBSCRIBE/CANCEL/etc.) is suppressed from all future Vacantless SMS by
// setting leads.sms_opt_out; START/YES re-enables them. Ordinary renter replies
// are logged to the matched lead timeline. This is our own second-layer
// suppression — Twilio's Advanced Opt-Out (enabled by default on a Messaging
// Service) already blocks the number at the carrier level and sends the standard
// confirmation, so we respond with EMPTY TwiML (no app-generated reply) to avoid
// a duplicate text, and just record the state here.
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

  const admin = createAdminClient();
  if (!admin) return twiml(); // not configured -> acknowledge, do nothing

  // Shared core: STOP/START flips lead + tenant opt-out state; ordinary renter
  // replies are logged to every matched lead timeline. No app-generated reply.
  await applyInboundSms(admin, { from: params.From ?? "", body: params.Body ?? "" });

  // Rely on Twilio's built-in opt-out confirmation; send no second message.
  return twiml();
}
