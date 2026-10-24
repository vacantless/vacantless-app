import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { buildListingCopy, buildRenterMessageReply } from "@/lib/listing-copy";
import { listingPostErrorMessage } from "@/lib/listing-distribution";
import { loadPhoneMarketplaceContext } from "@/lib/marketplace-kit-server";
import { marketplaceKitFacts, marketplaceKitPhotoUrls, marketplacePhoneKitPath } from "@/lib/marketplace-kit";
import { sortPhotos } from "@/lib/photos";
import { MarketplaceKitSteps } from "@/components/marketplace-kit-steps";
import { saveMarketplaceAdFromPhone } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Post on Facebook Marketplace", robots: { index: false, follow: false } };

// S736 (review item 9): the landlord's Marketplace kit on their phone, opened
// from the code the rental page shows on a computer or from the emailed link.
// No sign-in: the signed token names the account and the rental and works for
// 14 days (lib/marketplace-phone-link). Only what the public rental page shows,
// plus the box to save the ad link. Renter data is never read here.

export default async function PhoneMarketplaceKitPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();
  const loaded = await loadPhoneMarketplaceContext(admin, params.token, Date.now());
  if (!loaded.ok && loaded.reason === "too_old") {
    return (
      <main className="min-h-screen bg-gray-50 px-4 pt-10">
        <div className="mx-auto max-w-xl rounded-2xl border border-gray-200 bg-white p-5 text-[14px] leading-relaxed text-gray-700 shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">This link is too old</h1>
          <p className="mt-2">Phone links work for 14 days.</p>
          <p className="mt-1">Open the rental in Vacantless on your computer for a new one.</p>
        </div>
      </main>
    );
  }
  if (!loaded.ok) notFound();
  const ctx = loaded.ctx;
  const p = ctx.property;

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const publicUrl = host ? `${proto}://${host}/r/${p.id}` : `/r/${p.id}`;

  const copy = buildListingCopy(
    {
      businessName: ctx.org.name,
      address: p.address,
      rentCents: p.rent_cents,
      beds: p.beds,
      baths: p.baths,
      description: p.description,
      publicUrl,
      features: {
        available_date: p.available_date,
        sqft: p.sqft,
        heating_type: p.heating_type,
        security_deposit_cents: p.security_deposit_cents,
      },
    },
    "facebook",
  );

  const brand = accessibleBrand(ctx.org.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(ctx.org.brand_color, ctx.org.brand_color_secondary);
  const status = searchParams.status ?? null;
  const saved = status === "saved";
  const saveError = status && !saved ? listingPostErrorMessage(status) || "That link could not be saved. Try again." : null;
  const kitPath = marketplacePhoneKitPath(params.token);
  const photoUrls = marketplaceKitPhotoUrls(
    sortPhotos(ctx.photos).map((ph) => ph.url),
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  return (
    <main className="min-h-screen bg-gray-50 pb-12">
      <header className="px-4 py-5 text-white" style={{ background: brandBg || brand }}>
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{ctx.org.name || "Your rental"}</p>
          <h1 className="mt-1 text-lg font-bold">Post this rental on Facebook Marketplace</h1>
          <p className="mt-1 text-sm opacity-90">{p.address}</p>
        </div>
      </header>
      <div className="mx-auto max-w-xl px-4 pt-5">
        <p className="mb-4 text-[13px] leading-relaxed text-gray-700">
          Post it from the Facebook app on this phone. Everything you need is below.
        </p>
        {saved || ctx.liveUrl ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
            {saved ? "Saved. The rental now shows the ad as Live." : "This rental already has a Live Marketplace ad."}{" "}
            {ctx.liveUrl ? (
              <a href={ctx.liveUrl} target="_blank" rel="noreferrer" className="font-semibold underline">
                View the ad ↗
              </a>
            ) : null}
          </div>
        ) : null}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <MarketplaceKitSteps
            adText={copy.body}
            facts={marketplaceKitFacts(p)}
            photosHref={`${kitPath}/photos`}
            photoCount={ctx.photos.length}
            photoUrls={photoUrls}
            renterReply={buildRenterMessageReply({ publicUrl, phone: ctx.org.public_contact_phone })}
            saveAction={saveMarketplaceAdFromPhone}
            hiddenFields={{ token: params.token }}
            saveError={saveError}
          />
        </div>
      </div>
    </main>
  );
}
