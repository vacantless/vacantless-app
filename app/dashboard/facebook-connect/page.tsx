import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/membership";
import {
  FB_PAGES_COOKIE,
  facebookPageScopes,
  facebookReturnPath,
  finalizeFacebookPageConnection,
  igChannelEnabledForOrg,
  instagramAccountLabel,
  verifyPagesCookie,
} from "@/lib/facebook-page-oauth";

const FORBIDDEN = "/dashboard/properties?forbidden=1";

async function selectFacebookPage(formData: FormData) {
  "use server";
  await requireCapability("manage_properties", FORBIDDEN);
  const payload = verifyPagesCookie(cookies().get(FB_PAGES_COOKIE)?.value);
  if (!payload) redirect("/dashboard/properties?fb=error&reason=state");

  const pageId = String(formData.get("page_id") ?? "");
  const page = payload.pages.find((p) => p.id === pageId);
  if (!page) redirect(facebookReturnPath(payload.propertyId, "error", "page"));
  const instagramEnabled = igChannelEnabledForOrg(payload.orgId);

  try {
    await finalizeFacebookPageConnection({
      organizationId: payload.orgId,
      propertyId: payload.propertyId,
      page,
      connectedBy: payload.connectedBy,
      scopes: facebookPageScopes({ instagramEnabled }),
    });
  } catch {
    redirect(facebookReturnPath(payload.propertyId, "error", "store"));
  }
  cookies().delete(FB_PAGES_COOKIE);
  redirect(facebookReturnPath(payload.propertyId, "connected"));
}

export default async function FacebookConnectPage() {
  await requireCapability("manage_properties", FORBIDDEN);
  const payload = verifyPagesCookie(cookies().get(FB_PAGES_COOKIE)?.value);
  if (!payload) redirect("/dashboard/properties?fb=error&reason=state");
  const instagramEnabled = igChannelEnabledForOrg(payload.orgId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6">
        <p className="text-sm font-semibold text-brand">Facebook Page</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-950">
          Pick the Page for your rentals
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          We post your rentals to this Page when you post them. You can
          disconnect it any time in Settings.
        </p>
      </div>

      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {payload.pages.map((page) => (
          <form
            key={page.id}
            action={selectFacebookPage}
            className="flex items-center justify-between gap-4 px-4 py-3"
          >
            <input type="hidden" name="page_id" value={page.id} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {page.name}
              </p>
              {instagramEnabled && (
                <p className="truncate text-xs text-gray-500">
                  {page.instagram_business_account
                    ? `Instagram ${instagramAccountLabel(page.instagram_business_account)} linked`
                    : "No Instagram account linked to this Page"}
                </p>
              )}
            </div>
            <button
              type="submit"
              className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:opacity-90"
            >
              Use this Page
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
