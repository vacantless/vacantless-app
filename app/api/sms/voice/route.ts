import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyTwilioSignature } from "@/lib/sms";
import { logInboundCall } from "@/lib/sms-inbound";
import { orgForTextingNumber } from "@/lib/org-sms-numbers";
import { notifyOperatorsOfTextReply } from "@/lib/sms-reply-notify-server";

// S717: a renter calls a landlord's own texting number (Twilio). Nobody
// answers that number, so the caller hears one sentence, the call is logged
// on the renter's record at THAT landlord only, and the landlord is emailed
// to call back. Same as QUO calls to the shared number (app/api/quo/inbound).
//
// Configure on each Twilio number: "A call comes in" -> POST
// https://app.vacantless.com/api/sms/voice. Set TWILIO_VOICE_URL in Vercel if
// the reconstructed URL ever fails the signature check.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VOICE_MESSAGE =
  "Thanks for calling. This number only takes text messages. Please text us here, and we will get back to you.";

function twiml(body: string, status = 200) {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

const SAY_TWIML = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${VOICE_MESSAGE}</Say><Hangup/></Response>`;
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

export async function POST(req: NextRequest) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return twiml(SAY_TWIML);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return twiml(EMPTY_TWIML, 400);
  }
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";

  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const url = process.env.TWILIO_VOICE_URL || `${proto}://${host}${new URL(req.url).pathname}`;
  if (!verifyTwilioSignature(token, url, params, req.headers.get("x-twilio-signature"))) {
    return twiml(EMPTY_TWIML, 403);
  }

  const admin = createAdminClient();
  if (!admin) return twiml(SAY_TWIML);

  // Only calls to one of our landlord numbers are logged. An unknown number
  // is not ours to file, so the caller just hears the message.
  const ownerOrgId = await orgForTextingNumber(admin, params.To ?? "");
  if (ownerOrgId) {
    const summary = await logInboundCall(admin, {
      from: params.From ?? "",
      answered: false,
      voicemail: false,
      ownerOrgId,
    });
    for (const l of summary.calledLeads ?? []) {
      await notifyOperatorsOfTextReply(admin, {
        orgId: l.orgId,
        leadId: l.leadId,
        replyText: "(They called your texting number. Nobody answers it, so call them back.)",
      });
    }
  }
  return twiml(SAY_TWIML);
}
