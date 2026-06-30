import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, brandGradientCss } from "@/lib/brand-theme";
import { showingOutcomeLabel } from "@/lib/pipeline";
import { recordOutcomeFromToken } from "./actions";

export const dynamic = "force-dynamic";

// Public one-tap post-showing outcome page (outcome-nudge Slice 2). The operator
// arrives from the nudge email with NO session — the outcome_token in the URL is
// their only handle, the same magic-link pattern as /job/[token] and
// /repair/[token]. Read by the service-role admin client, scoped strictly to the
// row whose outcome_token matches; a wrong token reveals nothing. The page only
// RENDERS (GET) — the three buttons each POST the server action, so email link
// scanners that prefetch the GET URL can never record an outcome (KI585).

type Row = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
  organization: {
    name: string | null;
    brand_color: string | null;
    brand_color_secondary: string | null;
    logo_url: string | null;
    booking_timezone: string | null;
  } | null;
  lead: { name: string | null } | null;
  property: { address: string | null } | null;
};

function fmtWhen(iso: string | null, tz: string): string {
  if (!iso) return "the scheduled time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

const OUTCOME_BUTTONS: { value: string; label: string; hint: string }[] = [
  { value: "attended", label: "Attended", hint: "They came to the viewing" },
  { value: "no_show", label: "No-show", hint: "They didn't show up" },
  { value: "cancelled", label: "Cancelled", hint: "The viewing was called off" },
];

export default async function ShowingOutcomePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();

  const { data } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, outcome, " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url, booking_timezone), " +
        "lead:leads(name), property:properties(address)",
    )
    .eq("outcome_token", params.token)
    .maybeSingle();
  if (!data) notFound();
  const row = data as unknown as Row;

  const orgName = row.organization?.name || "Your team";
  const brand = accessibleBrand(row.organization?.brand_color || "#4f46e5");
  const brandBg = brandGradientCss(row.organization?.brand_color, row.organization?.brand_color_secondary);
  const tz = row.organization?.booking_timezone || "America/Toronto";

  const leadName = row.lead?.name?.trim() || "this prospect";
  const address = row.property?.address?.trim() || "the property";
  const when = fmtWhen(row.scheduled_at, tz);

  const status = searchParams.status;
  const recorded = status === "recorded";
  // A real (non-placeholder) outcome already on the row — shown as the current
  // value; the buttons stay available so the operator can correct a mis-tap.
  const currentOutcome =
    row.outcome && row.outcome !== "scheduled" ? showingOutcomeLabel(row.outcome) : null;

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ ["--brand-color" as string]: brand, ["--brand-gradient" as string]: brandBg }}
    >
      <header className="relative text-white shadow-md" style={{ background: brandBg }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="mx-auto max-w-2xl px-6 py-5">
          {row.organization?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.organization.logo_url} alt={orgName} className="h-8" />
          ) : (
            <p className="text-lg font-semibold">{orgName}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          {recorded && currentOutcome ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Thanks — recorded</h1>
              <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                Viewing for <span className="font-medium">{leadName}</span> at{" "}
                <span className="font-medium">{address}</span> marked{" "}
                <span className="font-medium">{currentOutcome}</span>.
              </p>
              <p className="mt-4 text-sm text-gray-600">
                {row.outcome === "attended"
                  ? "The prospect has been advanced in your pipeline. You can close this page."
                  : "Your pipeline is up to date. You can close this page."}
              </p>
              <div className="mt-6 border-t border-gray-100 pt-5">
                <p className="text-xs text-gray-500">Picked the wrong one? Change it:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {OUTCOME_BUTTONS.filter((b) => b.label !== currentOutcome).map((b) => (
                    <form key={b.value} action={recordOutcomeFromToken}>
                      <input type="hidden" name="token" value={params.token} />
                      <input type="hidden" name="outcome" value={b.value} />
                      <button
                        type="submit"
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {b.label}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">How did the viewing go?</h1>
              <p className="mt-2 text-sm text-gray-600">
                <span className="font-medium">{leadName}</span> at{" "}
                <span className="font-medium">{address}</span>
                <br />
                <span className="text-gray-500">{when}</span>
              </p>

              {currentOutcome && (
                <p className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                  Currently recorded as <span className="font-medium">{currentOutcome}</span>. Tap a
                  button below to change it.
                </p>
              )}
              {status === "error" && (
                <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  Something went wrong recording that. Please try again.
                </p>
              )}

              <div className="mt-6 space-y-3">
                {OUTCOME_BUTTONS.map((b) => (
                  <form key={b.value} action={recordOutcomeFromToken}>
                    <input type="hidden" name="token" value={params.token} />
                    <input type="hidden" name="outcome" value={b.value} />
                    <button
                      type="submit"
                      className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-4 py-3.5 text-left hover:border-gray-300 hover:bg-gray-50"
                    >
                      <span className="text-base font-semibold text-gray-900">{b.label}</span>
                      <span className="text-sm text-gray-500">{b.hint}</span>
                    </button>
                  </form>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
