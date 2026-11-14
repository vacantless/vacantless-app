import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { generateSlots, type Availability } from "@/lib/booking";
import { sortPhotos } from "@/lib/photos";
import { PageHeader } from "@/components/ui";
import { Icons } from "@/components/icons";
import { buildReplyKitCards, longDayLabel, nextTimesLabel, type ReplyKitPost, type ReplyKitProperty } from "@/lib/reply-kit";
import { ReplyKit } from "./reply-kit";

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

  const { data: propRows } = await supabase
    .from("properties")
    .select("id, address, rent_cents, beds, baths, status, archived_at, unit_type")
    .eq("organization_id", org.id)
    .is("archived_at", null)
    .limit(200);
  const properties = (propRows ?? []) as ReplyKitProperty[];

  const { data: postRows } = await supabase
    .from("listing_posts")
    .select("id, property_id, portal, status")
    .eq("organization_id", org.id)
    .eq("status", "live")
    .limit(500);
  const posts = (postRows ?? []) as ReplyKitPost[];

  const rpcClient = createAdminClient() ?? supabase;
  const timesByProperty = new Map<string, { hasViewingTimes: boolean; nextTimes: string | null }>();
  await Promise.all(
    properties
      .filter((p) => p.status === "available")
      .map(async (p) => {
        try {
          const { data, error } = await rpcClient.rpc("get_public_availability", { p_property_id: p.id });
          if (error || !data) return;
          const days = generateSlots(data as Availability);
          timesByProperty.set(p.id, {
            hasViewingTimes: days.some((d) => d.slots.length > 0),
            nextTimes: nextTimesLabel(days, longDayLabel),
          });
        } catch {
          // Keep the default wording when times can't be read.
        }
      }),
  );

  // S750: the chat shows the ad's first photo, so each card shows the cover.
  const propIds = properties.map((p) => p.id);
  const { data: photoRows } = propIds.length
    ? await supabase
        .from("property_photos")
        .select("id, property_id, url, sort_order, is_cover")
        .in("property_id", propIds)
        .limit(2000)
    : { data: [] };
  const photosByProperty = new Map<string, string[]>();
  const grouped = new Map<string, { id: string; url: string; sort_order: number; is_cover: boolean }[]>();
  for (const r of (photoRows ?? []) as { id: string; property_id: string; url: string; sort_order: number; is_cover: boolean }[]) {
    const list = grouped.get(r.property_id) ?? [];
    list.push(r);
    grouped.set(r.property_id, list);
  }
  for (const [id, list] of Array.from(grouped.entries())) {
    photosByProperty.set(id, sortPhotos(list).map((ph) => ph.url).filter(Boolean).slice(0, 3));
  }

  const cards = buildReplyKitCards({ appUrl: APP_URL, properties, posts, timesByProperty, photosByProperty });

  return (
    <div className="mx-auto max-w-xl px-1 py-4">
      <PageHeader
        icon={<Icons.chat />}
        title="Quick replies"
        subtitle="Match the photo and price from the chat. Pick the site, copy, and paste it in the chat. Each site has its own link, so you see where bookings come from."
      />
      <ReplyKit cards={cards} phone={org.public_contact_phone ?? null} />
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
