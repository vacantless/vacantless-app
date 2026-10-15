import { loadCalendarViewing } from "@/lib/viewing-calendar-server";
import { buildViewingIcs } from "@/lib/viewing-calendar";

export const dynamic = "force-dynamic";

// S721: the Apple / Outlook half of "Add to calendar". Read only (GET), always
// the viewing as it is now: a cancelled viewing comes back STATUS:CANCELLED.
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const v = await loadCalendarViewing(params.token);
  if (!v) return new Response("Not found", { status: 404 });
  return new Response(buildViewingIcs(v, Date.now()), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="viewing.ics"',
      "cache-control": "no-store",
    },
  });
}
