import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { buildingsForOrg, crewFromToken, unitCardsForOrg, type UnitCard } from "@/lib/unit-progress-server";
import { CREW_ROLE_LABEL, STAGE_DATE_LABEL, STAGE_LABEL, canAddUnit, isStage, stageDateLine, stageTakesDate, takesAdsDown, tapsFor, type Stage } from "@/lib/unit-progress";
import { addUnitFromCrewLink, tapStageFromCrewLink } from "./actions";

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
  const buildings = canAddUnit(crew.role) ? await buildingsForOrg(admin, crew.organization_id) : [];
  const inProgress = cards.filter((c) => c.status !== "leased");
  const rented = cards.filter((c) => c.status === "leased");

  const status = searchParams.status ?? "";
  const savedStage = status.startsWith("saved_") ? status.slice(6) : null;
  const savedUnit = cards.find((c) => c.id === searchParams.unit) ?? null;

  // S789: Rented, Lease signed and Moved in take the ads down, so each asks once.
  const needsConfirm = (s: Stage, c: UnitCard) => takesAdsDown(s) && c.status !== "leased";
  const confirmLabel = (s: Stage) =>
    s === "rented" ? "Yes, it's rented: take the ads down" : `Yes, ${STAGE_LABEL[s].toLowerCase()}: take the ads down`;

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
        {c.stage && c.stageDate && <p className="mt-1 text-sm text-gray-700">{stageDateLine(c.stage, c.stageDate)}</p>}
        {c.stageAt && (
          <p className="mt-1 text-xs text-gray-500">
            {fmtWhen(c.stageAt, tz)}
            {c.stageBy ? ` by ${c.stageBy}` : ""}
          </p>
        )}
        {buttons.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {buttons.map((s) =>
              needsConfirm(s, c) && searchParams.confirm !== `${c.id}:${s}` ? (
                <a
                  key={s}
                  href={`/crew/${encodeURIComponent(params.token)}?confirm=${c.id}:${s}#u-${c.id}`}
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
                >
                  {STAGE_LABEL[s]}
                </a>
              ) : (
              <form key={s} action={tapStageFromCrewLink} className={stageTakesDate(s) ? "flex items-center gap-2" : ""}>
                <input type="hidden" name="token" value={params.token} />
                <input type="hidden" name="property_id" value={c.id} />
                <input type="hidden" name="stage" value={s} />
                {stageTakesDate(s) && (
                  <label className="sr-only" htmlFor={`d-${c.id}-${s}`}>{STAGE_DATE_LABEL[s]}</label>
                )}
                {stageTakesDate(s) && (
                  <input id={`d-${c.id}-${s}`} type="date" name="due_date" className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                )}
                <button
                  type="submit"
                  className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                    needsConfirm(s, c)
                      ? "border-red-300 bg-red-50 text-red-800"
                      : "border-gray-300 bg-white text-gray-800"
                  }`}
                >
                  {needsConfirm(s, c) ? confirmLabel(s) : STAGE_LABEL[s]}
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
          {takesAdsDown(savedStage) ? " If its ads were up, they are coming down." : ""}
        </div>
      )}
      {(status === "added" || status === "add_existed") && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          {status === "added" ? "Unit added. It stays private until the landlord posts it." : "That unit was already here. Its card is below."}
        </div>
      )}
      {status.startsWith("add_") && status !== "add_existed" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {status === "add_bad_unit"
            ? "Type the unit number, like 22 or 4B."
            : status === "add_plan_full"
              ? "The account has no room for more rentals. Ask the landlord to add this unit."
              : status === "add_archived"
                ? "That unit was archived. Ask the landlord to bring it back."
                : "That unit was not added. Please try again."}
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

      {buildings.length > 0 && (
        <details className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-800">Add a unit</summary>
          <p className="mt-2 text-xs text-gray-500">For a unit that is not on this list yet. It stays private until the landlord posts it.</p>
          <form action={addUnitFromCrewLink} className="mt-3 space-y-2">
            <input type="hidden" name="token" value={params.token} />
            <label className="block text-xs font-medium text-gray-600" htmlFor="add-street">Building</label>
            <select id="add-street" name="street" required className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm">
              {buildings.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <label className="block text-xs font-medium text-gray-600" htmlFor="add-unit">Unit number</label>
            <input id="add-unit" name="unit" required maxLength={10} placeholder="22" className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm" />
            <label className="block text-xs font-medium text-gray-600" htmlFor="add-stage">Where it is at</label>
            <select id="add-stage" name="stage" className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm" defaultValue="under_construction">
              {tapsFor(crew.role, null)
                .filter((st) => !takesAdsDown(st))
                .map((st) => (
                  <option key={st} value={st}>{STAGE_LABEL[st]}</option>
                ))}
            </select>
            <label className="block text-xs font-medium text-gray-600" htmlFor="add-date">Date, if it has one</label>
            <input id="add-date" type="date" name="due_date" className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm" />
            <button type="submit" className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800">Add the unit</button>
          </form>
        </details>
      )}

      {rented.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Rented: {rented.length}</summary>
          <div className="mt-3 space-y-3">{rented.map(renderCard)}</div>
        </details>
      )}
    </main>
  );
}
