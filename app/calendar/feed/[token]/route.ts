import { loadCalendarFeed } from "@/lib/calendar-feed-server";
import { buildFeedIcs } from "@/lib/calendar-feed";

export const dynamic = "force-dynamic";

// S728: the subscribable viewings calendar. Read only; the signed token in
// the URL is the only key. Google and Apple poll it on their own schedule.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const feed = await loadCalendarFeed(params.token);
  if (!feed) return new Response("Not found", { status: 404 });
  return new Response(buildFeedIcs({ ...feed, nowMs: Date.now() }), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
