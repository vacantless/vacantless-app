import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { shootFromToken } from "@/lib/photo-shoot-server";
import { stageDateLine } from "@/lib/unit-progress";
import { photosInFromShootLink } from "./actions";

// S791a: a photographer's one-time link (PLAN-S788-UNIT-PROGRESS step 7).
// One unit: its address and shoot date, a box for the link to the photos and
// one button. No prices, no renter or tenant details. Once used it says so.

export const dynamic = "force-dynamic";
// Pulling photos from a Drive folder can take a little while.
export const maxDuration = 60;

function photosLine(raw: string | undefined): string {
  if (!raw) return "";
  const m = raw.match(/^added_(\d{1,3})$/);
  if (m) return Number(m[1]) > 0 ? `${m[1]} photo${m[1] === "1" ? "" : "s"} are on the rental now.` : "";
  return "";
}

export default async function ShootPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string; photos?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();
  const shoot = await shootFromToken(admin, params.token);
  if (!shoot) notFound();

  const { data: orgData } = await admin
    .from("organizations")
    .select("name, brand_color")
    .eq("id", shoot.organizationId)
    .maybeSingle();
  const org = orgData as { name: string | null; brand_color: string | null } | null;
  const brand = accessibleBrand(org?.brand_color || DEFAULT_BRAND_COLOR);
  const status = searchParams.status ?? "";
  const shootLine = shoot.shootDate ? stageDateLine("photographer_booked", shoot.shootDate) : "";

  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: brand }}>
        {org?.name || "Your client"}
      </p>
      <h1 className="mt-1 text-xl font-semibold text-gray-900">Photo shoot</h1>
      <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">{shoot.address}</h2>
        {shootLine && <p className="mt-1 text-sm text-gray-700">{shootLine}</p>}
        {shoot.photographerName && <p className="mt-1 text-xs text-gray-500">For {shoot.photographerName}</p>}

        {shoot.state === "used" || status === "done" ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Thank you. The photos are in and {org?.name || "the landlord"} has been told. {photosLine(searchParams.photos)} This link is done.
          </div>
        ) : shoot.state !== "open" ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            This link no longer works. Ask {org?.name || "the landlord"} for a new one.
          </div>
        ) : (
          <>
            {status === "no_link" && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Paste the link to the photos first.
              </div>
            )}
            {status === "error" && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                That did not save. Please try again.
              </div>
            )}
            <p className="mt-4 text-sm text-gray-600">
              When the photos are ready, paste the link to them and tap Photos are in. A Google Drive or Dropbox folder that anyone with the link can view comes in on its own. Any other link goes to {org?.name || "the landlord"} to add. This link works once.
            </p>
            <form action={photosInFromShootLink} className="mt-3 space-y-2">
              <input type="hidden" name="token" value={params.token} />
              <label className="block text-xs font-medium text-gray-600" htmlFor="photo-link">
                Link to the photos
              </label>
              <input
                id="photo-link"
                type="url"
                name="photo_link"
                required={!shoot.propertyHasFolder}
                maxLength={1000}
                placeholder="https://drive.google.com/drive/folders/..."
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
              />
              <button
                type="submit"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: brand }}
              >
                Photos are in
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
