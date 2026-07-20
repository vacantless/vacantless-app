import { NextResponse, type NextRequest } from "next/server";
import { hasEntitlement } from "@/lib/billing";
import {
  buildExtensionKit,
  EXTENSION_CHANNELS,
  type ExtensionChannelKey,
} from "@/lib/extension-kit";
import {
  buildTrackedLink,
  reservableTrackerId,
} from "@/lib/listing-distribution";
import { currentUserCan } from "@/lib/membership";
import { getCurrentOrg, type Org } from "@/lib/org";
import {
  resolveBuildingProfile,
  resolveEffectiveFeatures,
  type PolicyProfile,
} from "@/lib/policy-profile";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

type PropertyRow = {
  id: string;
  organization_id: string;
  address: string | null;
  rent_cents: number | null;
  beds: number | null;
  baths: number | string | null;
  description: string | null;
  available_date: string | null;
  virtual_tour_url: string | null;
  sqft: number | null;
  floor: string | null;
  parking: string | null;
  laundry: string | null;
  air_conditioning: boolean | null;
  balcony: boolean | null;
  furnished: boolean | null;
  pet_friendly: boolean | null;
  pets_cats: boolean | null;
  pets_dogs: boolean | null;
  pets_dog_size: string | null;
  pets_notes: string | null;
  heat_included: boolean | null;
  hydro_included: boolean | null;
  water_included: boolean | null;
  lease_term: string | null;
  smoking: string | null;
  ac_type: string | null;
  on_site_management: boolean | null;
  building_key: string | null;
};

type PhotoRow = {
  url: string | null;
  is_cover: boolean | null;
  sort_order: number | null;
};

type TrackerRow = {
  id: string;
  portal: string;
  status: string;
  created_at: string | null;
};

function configuredOrigin(): string | null {
  const origin = process.env.EXTENSION_ALLOWED_ORIGIN?.trim();
  return origin || null;
}

function notFound() {
  return new Response("Not found", { status: 404 });
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  };
}

function rejectBadCors(
  req: NextRequest,
  allowedOrigin: string,
): Response | null {
  const origin = req.headers.get("origin");
  if (origin && origin !== allowedOrigin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

function json(
  body: Record<string, unknown>,
  status: number,
  allowedOrigin: string,
) {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(allowedOrigin),
  });
}

function numberOrNull(value: number | string | null): number | null {
  if (value == null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function orgPolicyProfile(org: Org): PolicyProfile {
  return {
    lease_term: org.policy_lease_term,
    smoking: org.policy_smoking,
    ac_type: org.policy_ac_type,
    on_site_management: org.policy_on_site_management,
    heat_included: org.policy_heat_included,
    hydro_included: org.policy_hydro_included,
    water_included: org.policy_water_included,
    pets_cats: org.policy_pets_cats,
    pets_dogs: org.policy_pets_dogs,
    pets_dog_size: org.policy_pets_dog_size,
  };
}

async function reserveTrackerId({
  supabase,
  orgId,
  propertyId,
  channel,
}: {
  supabase: ReturnType<typeof createClient>;
  orgId: string;
  propertyId: string;
  channel: ExtensionChannelKey;
}): Promise<string | null> {
  const { data: existingPosts } = await supabase
    .from("listing_posts")
    .select("id, portal, status, created_at")
    .eq("property_id", propertyId)
    .eq("portal", channel)
    .neq("status", "removed");

  const reuseId = reservableTrackerId(
    ((existingPosts ?? []) as TrackerRow[]).map((row) => ({
      id: row.id,
      portal: row.portal,
      status: row.status,
      created_at: row.created_at ?? "",
    })),
    channel,
  );
  if (reuseId) return reuseId;

  const { data: draft, error: draftErr } = await supabase
    .from("listing_posts")
    .insert({
      organization_id: orgId,
      property_id: propertyId,
      portal: channel,
      status: "draft",
      url: null,
    })
    .select("id")
    .single();
  if (draft?.id) return draft.id as string;
  if (!draftErr) return null;

  const { data: raced } = await supabase
    .from("listing_posts")
    .select("id")
    .eq("property_id", propertyId)
    .eq("portal", channel)
    .eq("status", "draft")
    .is("url", null)
    .limit(1)
    .maybeSingle();
  return (raced?.id as string | undefined) ?? null;
}

async function methodNotAllowed(req: NextRequest) {
  const allowedOrigin = configuredOrigin();
  if (!allowedOrigin) return notFound();
  const corsRejection = rejectBadCors(req, allowedOrigin);
  if (corsRejection) return corsRejection;
  return new Response("Method not allowed", {
    status: 405,
    headers: {
      ...corsHeaders(allowedOrigin),
      Allow: "GET, OPTIONS",
    },
  });
}

export async function OPTIONS(req: NextRequest) {
  const allowedOrigin = configuredOrigin();
  if (!allowedOrigin) return notFound();
  const corsRejection = rejectBadCors(req, allowedOrigin);
  if (corsRejection) return corsRejection;
  return new Response(null, {
    status: 204,
    headers: corsHeaders(allowedOrigin),
  });
}

export async function GET(req: NextRequest) {
  const allowedOrigin = configuredOrigin();
  if (!allowedOrigin) return notFound();
  const corsRejection = rejectBadCors(req, allowedOrigin);
  if (corsRejection) return corsRejection;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ error: "sign_in" }, 401, allowedOrigin);

  const org = await getCurrentOrg();
  if (!org) return json({ error: "sign_in" }, 401, allowedOrigin);

  if (!(await currentUserCan("manage_properties"))) {
    return json({ error: "forbidden" }, 403, allowedOrigin);
  }
  if (!hasEntitlement(org.plan, "listing_marketing")) {
    return json({ error: "upgrade" }, 403, allowedOrigin);
  }

  const propertyId = req.nextUrl.searchParams.get("property")?.trim();
  if (!propertyId) {
    return json({ error: "property_required" }, 400, allowedOrigin);
  }

  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, organization_id, address, rent_cents, beds, baths, description, available_date, virtual_tour_url, sqft, floor, parking, laundry, air_conditioning, balcony, furnished, pet_friendly, pets_cats, pets_dogs, pets_dog_size, pets_notes, heat_included, hydro_included, water_included, lease_term, smoking, ac_type, on_site_management, building_key",
    )
    .eq("id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!property) return json({ error: "not_found" }, 404, allowedOrigin);

  const p = property as PropertyRow;
  let buildingProfile: PolicyProfile | null = null;
  if (p.building_key) {
    const { data: bp } = await supabase
      .from("org_building_policies")
      .select(
        "policy_lease_term, policy_smoking, policy_ac_type, policy_on_site_management, policy_heat_included, policy_hydro_included, policy_water_included, policy_pets_cats, policy_pets_dogs, policy_pets_dog_size",
      )
      .eq("organization_id", org.id)
      .eq("building_key", p.building_key)
      .maybeSingle();
    if (bp) {
      buildingProfile = {
        lease_term: bp.policy_lease_term,
        smoking: bp.policy_smoking,
        ac_type: bp.policy_ac_type,
        on_site_management: bp.policy_on_site_management,
        heat_included: bp.policy_heat_included,
        hydro_included: bp.policy_hydro_included,
        water_included: bp.policy_water_included,
        pets_cats: bp.policy_pets_cats,
        pets_dogs: bp.policy_pets_dogs,
        pets_dog_size: bp.policy_pets_dog_size,
      };
    }
  }

  const { features, inherited } = resolveEffectiveFeatures(
    {
      available_date: p.available_date,
      sqft: p.sqft,
      floor: p.floor,
      parking: p.parking,
      laundry: p.laundry,
      air_conditioning: p.air_conditioning,
      balcony: p.balcony,
      furnished: p.furnished,
      pet_friendly: p.pet_friendly,
      pets_cats: p.pets_cats,
      pets_dogs: p.pets_dogs,
      pets_dog_size: p.pets_dog_size,
      pets_notes: p.pets_notes,
      heat_included: p.heat_included,
      hydro_included: p.hydro_included,
      water_included: p.water_included,
      lease_term: p.lease_term,
      smoking: p.smoking,
      ac_type: p.ac_type,
      on_site_management: p.on_site_management,
    },
    resolveBuildingProfile(buildingProfile, orgPolicyProfile(org)),
  );

  const { data: photos } = await supabase
    .from("property_photos")
    .select("url, sort_order, is_cover")
    .eq("property_id", p.id);

  const publicUrl = `${BASE_URL.replace(/\/$/, "")}/r/${encodeURIComponent(
    p.id,
  )}`;
  const trackedLinks = {} as Record<ExtensionChannelKey, string>;
  for (const channel of EXTENSION_CHANNELS) {
    const trackerId = await reserveTrackerId({
      supabase,
      orgId: org.id,
      propertyId: p.id,
      channel,
    });
    if (!trackerId) {
      return json({ error: "tracker_unavailable" }, 503, allowedOrigin);
    }
    trackedLinks[channel] = buildTrackedLink(publicUrl, trackerId);
  }

  const kit = buildExtensionKit({
    property: { id: p.id, address: p.address ?? "" },
    listing: {
      businessName: org.name,
      address: p.address ?? "",
      rentCents: p.rent_cents,
      beds: p.beds,
      baths: numberOrNull(p.baths),
      description: p.description,
      publicUrl,
      leadContactEmail: org.public_contact_email ?? org.reply_to_email,
      leadContactPhone: org.public_contact_phone,
      virtualTourUrl: p.virtual_tour_url,
      features,
      inheritedPolicyFields: [...inherited],
    },
    trackedLinks,
    photos: ((photos ?? []) as PhotoRow[]).map((photo) => ({
      url: photo.url,
      isCover: photo.is_cover,
      sortOrder: photo.sort_order,
    })),
    generatedAt: new Date().toISOString(),
  });

  return NextResponse.json(kit, {
    status: 200,
    headers: corsHeaders(allowedOrigin),
  });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
