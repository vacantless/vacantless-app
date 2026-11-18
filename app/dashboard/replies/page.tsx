import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { loadReplyKitCards } from "@/lib/reply-kit-server";
import { ReplyKit } from "./reply-kit";
import { SendShortcutCard } from "./send-shortcut-card";
import { SEND_SHORTCUT_FILE } from "@/lib/send-shortcut-copy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Quick replies",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Vacantless Replies", statusBarStyle: "default" },
};

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

// S750: Quick replies, the phone reply kit (lib/reply-kit). Signed in, scoped to
// the selected account by RLS. Reads only what the public rental page shows,
// plus which sites each ad is live on.

export default async function QuickRepliesPage() {
  const org = await getCurrentOrg();
  if (!org) redirect("/login?next=/dashboard/replies");
  const supabase = createClient();

  const rpcClient = createAdminClient() ?? supabase;
  const cards = await loadReplyKitCards(supabase, rpcClient, org.id, APP_URL);

  // S816l: this person's "Send to Vacantless" key, if any (only its last 4).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let keyHint: string | null = null;
  let keyLastUsed: string | null = null;
  if (user) {
    const { data: keyRow } = await supabase
      .from("capture_keys")
      .select("key_hint, last_used_at")
      .eq("user_id", user.id)
      .eq("organization_id", org.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const k = keyRow as { key_hint: string; last_used_at: string | null } | null;
    keyHint = k?.key_hint ?? null;
    keyLastUsed = k?.last_used_at
      ? new Date(k.last_used_at).toLocaleString("en-CA", { timeZone: org.booking_timezone || "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : null;
  }
  const shortcutUrl = process.env.NEXT_PUBLIC_SEND_SHORTCUT_URL?.trim() || `${APP_URL}${SEND_SHORTCUT_FILE}`;

  return (
    <div className="mx-auto max-w-xl px-1 py-4">
      <PageHeader
        icon={<Icons.chat />}
        title="Quick replies"
        subtitle="Match the photo and price from the chat. Pick the site and what they asked. Copy it and paste it in the chat. Type the name first and Copy also saves the renter."
      />
      <ReplyKit cards={cards} phone={org.public_contact_phone ?? null} />
      <SendShortcutCard appUrl={APP_URL} hint={keyHint} lastUsed={keyLastUsed} shortcutUrl={shortcutUrl} />
      <details className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <summary className="cursor-pointer font-medium text-gray-900">Put this on your phone&apos;s home screen</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Open this page in Safari on your iPhone, or Chrome on Android.</li>
          <li>Tap Share, then &quot;Add to Home Screen&quot;. It opens like an app.</li>
          <li>Optional on iPhone: in the Shortcuts app, make a shortcut that opens this page.</li>
          <li>Then go to Settings, Accessibility, Touch, Back Tap. Set Double Tap to that shortcut.</li>
          <li>Then tap the back of your phone twice to open your replies.</li>
        </ol>
      </details>
    </div>
  );
}
