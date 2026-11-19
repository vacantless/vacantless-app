import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { getCurrentRole } from "@/lib/membership";
import { roleCan } from "@/lib/roles";
import { aiConfigured } from "@/lib/ai-call";
import { checkScreenshot } from "@/lib/ai-screenshot-lead";
import { shortcutReply, shortcutReplyLine, SEND_ERRORS } from "@/lib/send-shortcut";
import { saveRenterFromShortcut } from "@/lib/send-shortcut-server";
import { loadReplyKitCards } from "@/lib/reply-kit-server";
import { ANDROID_SHARE_NOTE, SHARE_PAGE_HEADERS, SHARE_TARGET_FIELD, renderSharePage, shareSaved } from "@/lib/share-target";

// S821b: Android "Share to Vacantless" (app/manifest.ts share_target). The
// installed app receives a chat screenshot from Android's Share menu. The
// landlord's own sign-in decides the account: no key, no Shortcut. It saves
// the renter the same way the iPhone Shortcut does (saveRenterFromShortcut)
// and shows the Quick replies answer with a Copy button.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/$/, "");

function page(input: { line: string; reply?: string | null; link?: string | null; ok: boolean }, status = 200): NextResponse {
  return new NextResponse(renderSharePage({ line: input.line, reply: input.reply ?? null, link: input.link ?? null, ok: input.ok }), {
    status,
    headers: SHARE_PAGE_HEADERS,
  });
}

/** Opened by hand, or reloaded after a share: there is nothing to show. */
export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/dashboard/replies", request.url), 303);
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // A share cannot be replayed after signing in, so say so on the way back.
    return NextResponse.redirect(new URL("/login?next=%2Fdashboard%2Freplies%3Fshare%3Dsignin", request.url), 303);
  }
  const org = await getCurrentOrg();
  const role = await getCurrentRole();
  if (!org || !role || !roleCan(role, "manage_leads")) return page({ line: SEND_ERRORS.role, ok: false }, 403);

  let file: File | null = null;
  try {
    const form = await request.formData();
    const raw = form.get(SHARE_TARGET_FIELD);
    file = raw instanceof File ? raw : null;
  } catch {
    file = null;
  }
  const check = checkScreenshot(file);
  if (!check.ok) return page({ line: SEND_ERRORS[check.reason], ok: false }, 400);
  const admin = createAdminClient();
  if (!admin || !aiConfigured()) return page({ line: SEND_ERRORS.off, ok: false }, 503);

  try {
    const base64 = Buffer.from(await file!.arrayBuffer()).toString("base64");
    const r = await saveRenterFromShortcut(
      admin,
      { keyId: "android-share", orgId: org.id, userId: user.id },
      { mediaType: file!.type, base64 },
      { via: ANDROID_SHARE_NOTE },
    );
    let reply: string | null = null;
    let replyLine: string | null = null;
    if (r.rentalId || r.name) {
      try {
        const cards = r.rentalId ? await loadReplyKitCards(admin, admin, org.id, APP_URL, { propertyIds: [r.rentalId] }) : [];
        const picked = shortcutReply({
          card: cards.find((c) => c.propertyId === r.rentalId) ?? null,
          site: r.site,
          question: r.question,
          phone: org.public_contact_phone ?? null,
          renterName: r.name ?? null,
        });
        reply = picked.text;
        // On Android the landlord taps Copy on this page; nothing is copied for them.
        replyLine = picked.why === "ok" ? null : shortcutReplyLine(picked.why);
      } catch (e) {
        console.error(`[share-target] reply skipped: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return page({
      line: [r.line, replyLine].filter(Boolean).join("\n"),
      reply,
      link: r.leadId ? `/dashboard/leads/${r.leadId}` : null,
      ok: shareSaved(r.line),
    });
  } catch (e) {
    console.error(`[share-target] ${e instanceof Error ? e.message : String(e)}`);
    return page({ line: "Something went wrong and the renter was not saved. Try again in a minute.", ok: false }, 500);
  }
}
