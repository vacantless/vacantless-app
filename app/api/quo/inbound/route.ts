import { NextResponse, type NextRequest } from "next/server";
import { parseOpenPhoneInbound, verifyOpenPhoneSignature } from "@/lib/sms";
import { applyInboundSms } from "@/lib/sms-inbound";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secret = process.env.QUO_WEBHOOK_SIGNING_SECRET;

  // Dark by default: until Noam configures the QUO webhook signing secret in
  // Vercel, acknowledge and do nothing so production behavior is unchanged.
  if (!secret) return NextResponse.json({ ok: true, handled: "unconfigured" });

  const signature = req.headers.get("openphone-signature");
  if (!verifyOpenPhoneSignature(secret, signature, rawBody, { nowMs: Date.now() })) {
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true, handled: "bad_payload" });
  }

  const inbound = parseOpenPhoneInbound(payload);
  if (!inbound) return NextResponse.json({ ok: true, handled: "ignored_event" });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ ok: true, handled: "unconfigured_admin" });

  // S521 owns /api/quo/inbound for renter replies. Future S518 text-in/MMS
  // capture should extend this dispatch point rather than adding a second QUO
  // webhook route.
  const summary = await applyInboundSms(admin, {
    from: inbound.from,
    body: inbound.body,
  });

  return NextResponse.json({ ok: true, handled: "message_received", summary });
}
