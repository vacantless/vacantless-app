import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { buildListingCopy, buildRenterMessageReply } from "@/lib/listing-copy";
import { listingPostErrorMessage } from "@/lib/listing-distribution";
import { loadAgentMarketplaceContext } from "@/lib/marketplace-kit-server";
import { agentMarketplaceKitPath } from "@/lib/marketplace-kit";
import { MarketplaceKitSteps } from "@/components/marketplace-kit-steps";
import { saveMarketplaceAdFromToken } from "./actions";

export const dynamic = "force-dynamic";

// S712: a showing agent's no-login page for posting one rental on Facebook
// Marketplace. Reached from the "Please post ... on Facebook Marketplace" email
// the landlord sends from the rental page. The agent token is the handle (the
// same stable token as their viewings page) and the rental must be in the
// agent's org. Only listing facts are shown; no renter data. Saving the ad link
// is a POST, so link scanners that fetch this page never write anything.

export default async function AgentMarketplaceKitPage({
  params,
  searchParams,
}: {
  params: { token: string; propertyId: string };
  searchParams: { status?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();
  const ctx = await loadAgentMarketplaceContext(admin, params.token, params.propertyId);
  if (!ctx) notFound();

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const publicUrl = host ? `${proto}://${host}/r/${ctx.property.id}` : `/r/${ctx.property.id}`;

  const copy = buildListingCopy(
    {
      businessName: ctx.org.name,
      address: ctx.property.address,
      rentCents: ctx.property.rent_cents,
      beds: ctx.property.beds,
      baths: ctx.property.baths,
      description: ctx.property.description,
      publicUrl,
    },
    "facebook",
  );
  const facts: { label: string; value: string }[] = [];
  const p = ctx.property;
  if (p.rent_cents) facts.push({ label: "Price per month", value: `$${Math.round(p.rent_cents / 100).toLocaleString("en-US")}` });
  if (p.beds != null) facts.push({ label: "Bedrooms", value: String(p.beds) });
  if (p.baths != null) facts.push({ label: "Bathrooms", value: String(p.baths) });
  if (p.sqft) facts.push({ label: "Square feet", value: String(p.sqft) });
  if (p.address) facts.push({ label: "Address", value: p.address });
  if (p.available_date) facts.push({ label: "Available", value: p.available_date });

  const brand = accessibleBrand(ctx.org.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(ctx.org.brand_color, ctx.org.brand_color_secondary);
  const status = searchParams.status ?? null;
  const saved = status === "saved";
  const saveError = status && !saved ? listingPostErrorMessage(status) || "That link could not be saved. Try again." : null;
  const kitPath = agentMarketplaceKitPath(params.token, ctx.property.id);

  return (
    <main className="min-h-screen bg-gray-50 pb-12">
      <header className="px-4 py-5 text-white" style={{ background: brandBg || brand }}>
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-wider opacity-80">
            {ctx.org.name || "Your team"}
          </p>
          <h1 className="mt-1 text-lg font-bold">Post this rental on Facebook Marketplace</h1>
          <p className="mt-1 text-sm opacity-90">{p.address}</p>
        </div>
      </header>
      <div className="mx-auto max-w-xl px-4 pt-5">
        <p className="mb-4 text-[13px] leading-relaxed text-gray-700">
          Hi {ctx.agent.name}. Facebook only lets people post rentals on Marketplace, so please post
          this one from your own Facebook. Everything you need is below.
        </p>
        {saved || ctx.liveUrl ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
            {saved ? "Saved. The rental now shows the ad as live. Thank you." : "This rental already has a live Marketplace ad."}{" "}
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
            facts={facts}
            photosHref={`${kitPath}/photos`}
            photoCount={ctx.photos.length}
            renterReply={buildRenterMessageReply({ publicUrl, phone: ctx.org.public_contact_phone })}
            saveAction={saveMarketplaceAdFromToken}
            hiddenFields={{ token: params.token, property_id: ctx.property.id }}
            saveError={saveError}
          />
        </div>
      </div>
    </main>
  );
}
