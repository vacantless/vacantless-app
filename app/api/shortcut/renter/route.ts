import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiConfigured } from "@/lib/ai-call";
import { checkScreenshot } from "@/lib/ai-screenshot-lead";
import { readSendKey, SEND_ERRORS } from "@/lib/send-shortcut";
import { checkSendKey, saveRenterFromShortcut } from "@/lib/send-shortcut-server";

// S816l: "Send to Vacantless" from the iPhone share menu. The Apple Shortcut
// posts a form with "screenshot" (the picture) and "key" (the landlord's
// key, or an Authorization: Bearer header). The answer is one plain line the
// Shortcut shows, plus the renter's page when one was saved.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/$/, "");

function say(line: string, status = 200): NextResponse {
  return new NextResponse(line, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) return say(SEND_ERRORS.off, 503);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return say(SEND_ERRORS.missing, 400);
  }
  const key = readSendKey(request.headers.get("authorization"), form.get("key"));
  if (!key) return say(SEND_ERRORS.key, 401);
  const owner = await checkSendKey(admin, key);
  if (!owner.ok) return say(SEND_ERRORS[owner.reason], owner.reason === "limit" ? 429 : owner.reason === "role" ? 403 : 401);

  const raw = form.get("screenshot") ?? form.get("file");
  const file = raw instanceof File ? raw : null;
  const check = checkScreenshot(file);
  if (!check.ok) return say(SEND_ERRORS[check.reason], 400);
  if (!aiConfigured()) return say(SEND_ERRORS.off, 503);

  try {
    const base64 = Buffer.from(await file!.arrayBuffer()).toString("base64");
    const r = await saveRenterFromShortcut(admin, owner.owner, { mediaType: file!.type, base64 });
    return say(r.leadId ? `${r.line}\n${APP_URL}/dashboard/leads/${r.leadId}` : r.line);
  } catch (e) {
    console.error(`[shortcut/renter] ${e instanceof Error ? e.message : String(e)}`);
    return say("Something went wrong and the renter was not saved. Try again in a minute.", 500);
  }
}
