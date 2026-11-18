import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfigured } from "@/lib/ai-call";
import { checkScreenshot } from "@/lib/ai-screenshot-lead";
import { readSendKey, shortcutReply, shortcutReplyLine, sniffImageType, SEND_ERRORS } from "@/lib/send-shortcut";
import { checkSendKey, saveRenterFromShortcut } from "@/lib/send-shortcut-server";
import { loadReplyKitCards } from "@/lib/reply-kit-server";

// S816l: "Send to Vacantless" from the iPhone share menu. The Apple Shortcut
// posts the picture as the body with "Authorization: Bearer <key>" (or a
// form with "screenshot" and "key"). The answer is one plain line the
// Shortcut shows, plus the renter's page when one was saved.
// S817b: with ?v=2 (the Shortcut from S817b on) the answer is JSON:
// { line, reply, link }. "reply" is the Quick replies text for that rental,
// site and question, which the Shortcut copies; null when there is none.
// Older Shortcuts (no v=2) still get the plain line.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/$/, "");

function say(line: string, status = 200): NextResponse {
  return new NextResponse(line, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function sayJson(body: { line: string; reply: string | null; link: string | null }, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const v2 = new URL(request.url).searchParams.get("v") === "2";
  return handle(request, v2);
}

async function handle(request: Request, v2: boolean): Promise<NextResponse> {
  const fail = (line: string, status: number) => (v2 ? sayJson({ line, reply: null, link: null }, status) : say(line, status));
  const admin = createAdminClient();
  if (!admin) return fail(SEND_ERRORS.off, 503);
  // Two shapes: the Shortcut sends the picture as the whole body with the key
  // in an Authorization header, or a form with "screenshot" and "key".
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  let formKey: unknown = null;
  let file: { type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> } | null = null;
  if (type.startsWith("multipart/form-data") || type.startsWith("application/x-www-form-urlencoded")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(SEND_ERRORS.missing, 400);
    }
    formKey = form.get("key");
    const raw = form.get("screenshot") ?? form.get("file");
    file = raw instanceof File ? raw : null;
  } else {
    const buf = await request.arrayBuffer().catch(() => new ArrayBuffer(0));
    const mediaType = sniffImageType(new Uint8Array(buf.slice(0, 8))) ?? type.split(";")[0].trim();
    file = buf.byteLength > 0 ? { type: mediaType, size: buf.byteLength, arrayBuffer: async () => buf } : null;
  }
  const key = readSendKey(request.headers.get("authorization"), formKey);
  if (!key) return fail(SEND_ERRORS.key, 401);
  const owner = await checkSendKey(admin, key);
  if (!owner.ok) return fail(SEND_ERRORS[owner.reason], owner.reason === "limit" ? 429 : owner.reason === "role" ? 403 : 401);

  const check = checkScreenshot(file);
  if (!check.ok) return fail(SEND_ERRORS[check.reason], 400);
  if (!aiConfigured()) return fail(SEND_ERRORS.off, 503);

  try {
    const base64 = Buffer.from(await file!.arrayBuffer()).toString("base64");
    const r = await saveRenterFromShortcut(admin, owner.owner, { mediaType: file!.type, base64 });
    const link = r.leadId ? `${APP_URL}/dashboard/leads/${r.leadId}` : null;
    if (!v2) return say(link ? `${r.line}\n${link}` : r.line);
    // The same reply Quick replies would give. A failed read only skips the copy.
    let reply: string | null = null;
    let replyLine: string | null = null;
    if (r.rentalId || r.name) {
      try {
        const orgId = owner.owner.orgId;
        const [cards, { data: orgRow }] = await Promise.all([
          r.rentalId ? loadReplyKitCards(admin, admin, orgId, APP_URL, { propertyIds: [r.rentalId] }) : Promise.resolve([]),
          admin.from("organizations").select("public_contact_phone").eq("id", orgId).maybeSingle(),
        ]);
        const picked = shortcutReply({
          card: cards.find((c) => c.propertyId === r.rentalId) ?? null,
          site: r.site,
          question: r.question,
          phone: (orgRow as { public_contact_phone: string | null } | null)?.public_contact_phone ?? null,
          renterName: r.name ?? null,
        });
        reply = picked.text;
        replyLine = shortcutReplyLine(picked.why);
      } catch (e) {
        console.error(`[shortcut/renter] reply skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return sayJson({ line: [r.line, replyLine].filter(Boolean).join("\n\n"), reply, link });
  } catch (e) {
    console.error(`[shortcut/renter] ${e instanceof Error ? e.message : String(e)}`);
    return fail("Something went wrong and the renter was not saved. Try again in a minute.", 500);
  }
}
