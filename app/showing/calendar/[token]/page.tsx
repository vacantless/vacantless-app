import { notFound } from "next/navigation";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { loadCalendarViewing } from "@/lib/viewing-calendar-server";
import { googleCalendarUrl } from "@/lib/viewing-calendar";

export const dynamic = "force-dynamic";

// S721: "Add to calendar" page for one viewing. Linked from the renter's
// confirmation and new-time emails and from the team's viewing alerts. The
// link is signed (lib/viewing-calendar.ts), so a guessed id shows nothing.
// GET only renders; nothing here changes the viewing.

function fmtWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export default async function ViewingCalendarPage({ params }: { params: { token: string } }) {
  const v = await loadCalendarViewing(params.token);
  if (!v) notFound();

  const orgName = v.org?.name || "Your leasing team";
  const brand = accessibleBrand(v.org?.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(v.org?.brand_color, v.org?.brand_color_secondary);
  const address = v.address?.trim() || "the property";
  const when = fmtWhen(v.startIso, v.timeZone);
  const isPast = new Date(v.startIso).getTime() < Date.now() - 60 * 60_000;
  const closed = v.outcome === "attended" || v.outcome === "no_show";
  const icsUrl = `/showing/calendar/${encodeURIComponent(params.token)}/ics`;

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ ["--brand-color" as string]: brand, ["--brand-gradient" as string]: brandBg }}
    >
      <header className="relative text-white shadow-md" style={{ background: brandBg }}>
        <div className="mx-auto max-w-2xl px-6 py-5">
          {v.org?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.org.logo_url} alt={orgName} className="h-8" />
          ) : (
            <p className="text-lg font-semibold">{orgName}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          {v.cancelled ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">This viewing was cancelled</h1>
              <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                The viewing at <span className="font-medium">{address}</span> ({when}) is off. If you
                added it to your calendar, you can delete it.
              </p>
              {v.propertyId && (
                <a
                  href={`/r/${v.propertyId}`}
                  className="mt-6 inline-flex items-center justify-center rounded-xl px-4 py-3 text-base font-semibold text-white shadow-sm"
                  style={{ background: brandBg }}
                >
                  Book a new viewing
                </a>
              )}
            </>
          ) : closed || isPast ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">This viewing has passed</h1>
              <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                The viewing at <span className="font-medium">{address}</span> was on {when}.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Add this viewing to your calendar</h1>
              <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                <p className="font-medium">{address}</p>
                <p className="mt-1">{when}</p>
              </div>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a
                  href={googleCalendarUrl(v)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-xl px-4 py-3 text-base font-semibold text-white shadow-sm"
                  style={{ background: brandBg }}
                >
                  Add to Google Calendar
                </a>
                <a
                  href={icsUrl}
                  className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-3 text-base font-semibold text-gray-800 shadow-sm"
                >
                  Add to Apple or Outlook calendar
                </a>
              </div>
              <p className="mt-4 text-sm text-gray-500">
                If the time changes, you will get an email with the new time and this page will show it.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
