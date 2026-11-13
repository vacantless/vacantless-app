import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { crewFromToken, unitCardsForOrg, type UnitCard } from "@/lib/unit-progress-server";
import { CREW_ROLE_LABEL, STAGE_LABEL, isStage, tapsFor } from "@/lib/unit-progress";
import { tapStageFromCrewLink } from "./actions";

export const dynamic = "force-dynamic";

// S788b: a crew member's no-login page (PLAN-S788-UNIT-PROGRESS). One card
// per rental with its current stage and the buttons this person may tap.
// Shows addresses and stages only: no prices, no renter or tenant details.

function fmtWhen(iso: string | null, tz: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export default async function CrewPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string; unit?: string; confirm?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();
  const crew = await crewFromToken(admin, params.token);
  if (!crew) notFound();

  const { data: orgData } = await admin
    .from("organizations")
    .select("name, brand_color, booking_timezone")
    .eq("id", crew.organization_id)
    .maybeSingle();
  const org = orgData as { name: string | null; brand_color: string | null; booking_timezone: string | null } | null;
  const brand = accessibleBrand(org?.brand_color || DEFAULT_BRAND_COLOR);
  const tz = org?.booking_timezone || "America/Toronto";

  const cards = await unitCardsForOrg(admin, crew.organization_id);
  const inProgress = cards.filter((c) => c.status !== "leased");
  const rented = cards.filter((c) => c.status === "leased");

  const status = searchParams.status ?? "";
  const savedStage = status.startsWith("saved_") ? status.slice(6) : null;
  const savedUnit = cards.find((c) => c.id === searchParams.unit) ?? null;

  const renderCard = (c: UnitCard) => {
    const buttons = tapsFor(crew.role, c.stage);
    return (
      <div key={c.id} id={`u-${c.id}`} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-gray-900">{c.address}</h2>
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
            {c.stage ? STAGE_LABEL[c.stage] : "No stage yet"}
          </span>
        </div>
        {c.stageAt && (
          <p className="mt-1 text-xs text-gray-500">
            {fmtWhen(c.stageAt, tz)}
            {c.stageBy ? ` by ${c.stageBy}` : ""}
          </p>
        )}
        {buttons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {buttons.map((s) =>
              s === "rented" && searchParams.confirm !== c.id ? (
                <a
                  key={s}
                  href={`/crew/${encodeURIComponent(params.token)}?confirm=${c.id}#u-${c.id}`}
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
                >
                  {STAGE_LABEL[s]}
                </a>
              ) : (
              <form key={s} action={tapStageFromCrewLink}>
                <input type="hidden" name="token" value={params.token} />
                <input type="hidden" name="property_id" value={c.id} />
                <input type="hidden" name="stage" value={s} />
                <button
                  type="submit"
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    s === "rented"
                      ? "border-red-300 bg-red-50 text-red-800"
                      : "border-gray-300 bg-white text-gray-800"
                  }`}
                >
                  {s === "rented" ? "Yes, it's rented: take the ads down" : STAGE_LABEL[s]}
                </button>
              </form>
              ),
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: brand }}>
        {org?.name || "Your team"}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-gray-900">Unit progress</h1>
      <p className="mt-1 text-sm text-gray-600">
        {crew.name}, {CREW_ROLE_LABEL[crew.role].toLowerCase()}. Tap where each unit is at. Every change is saved with your name.
      </p>

      {savedStage && isStage(savedStage) && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          Saved: {savedUnit?.address ?? "the unit"} is now {STAGE_LABEL[savedStage].toLowerCase()}.
          {savedStage === "rented" ? " Its ads are coming down." : ""}
        </div>
      )}
      {status === "not_allowed" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          That step is not on your link. Ask the landlord to set it.
        </div>
      )}
      {status === "error" && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          That did not save. Please try again.
        </div>
      )}

      <div className="mt-5 space-y-3">
        {inProgress.length === 0 && <p className="text-sm text-gray-600">No units yet.</p>}
        {inProgress.map(renderCard)}
      </div>

      {rented.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Rented: {rented.length}</summary>
          <div className="mt-3 space-y-3">{rented.map(renderCard)}</div>
        </details>
      )}
    </main>
  );
}
