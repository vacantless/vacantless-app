// ============================================================================
// question-sheet-load - server-side loader for the Post Everywhere question
// sheet (SPEC-S688 Slice 2 sections 4.2 + 4.4, S692). One function reads the
// property, its org, the building/org policy inheritance, the photo count and
// the selected channels, and hands buildQuestionSheet() its input.
//
// DARK UNTIL 0226 (spec 4.4 rule 2). `properties.question_sheet_completed_at`,
// `properties.question_sheet_channels` and `organizations.for_rent_by` are
// added by migration 0226, which is HELD (one Supabase project, every
// migration is prod). Those three columns are read in their OWN queries; a
// "column does not exist" answer (42703 / PGRST204) returns
// `{ available: false, reason: "column_missing" }` and the callers keep their
// pre-Slice-2 behaviour. Any other error is an error. The day 0226 lands the
// sheet appears with no deploy.
// ============================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildQuestionSheet,
  type OrgForSheet,
  type PropertyForSheet,
  type QuestionSheet,
  type QuestionSheetInput,
} from "./question-sheet";
import {
  resolveBuildingProfile,
  resolveEffectiveFeatures,
  type PolicyProfile,
} from "./policy-profile";
import { publishChannelChoices } from "./distribution-publish";
import {
  portalRequirementsFor,
  type PortalRequirementChannelKey,
} from "./portal-requirements";

function isPortalRequirementChannelKey(channel: string): channel is PortalRequirementChannelKey {
  return portalRequirementsFor(channel) != null;
}

/** The org columns the loader needs; getCurrentOrg() returns a superset. */
export type OrgForSheetLoad = {
  id: string;
  public_contact_phone: string | null;
  public_contact_email: string | null;
  reply_to_email: string | null;
  policy_lease_term?: string | null;
  policy_smoking?: string | null;
  policy_ac_type?: string | null;
  policy_on_site_management?: boolean | null;
  policy_heat_included?: boolean | null;
  policy_hydro_included?: boolean | null;
  policy_water_included?: boolean | null;
  policy_pets_cats?: boolean | null;
  policy_pets_dogs?: boolean | null;
  policy_pets_dog_size?: string | null;
};

export type QuestionSheetLoad =
  | { available: false; reason: "column_missing" | "not_found" | "error"; message: string }
  | {
      available: true;
      input: QuestionSheetInput;
      sheet: QuestionSheet;
      /** properties.for_rent_by as stored (NOT NULL default owner); the stamp mirrors org -> property. */
      propertyForRentBy: string | null;
    };

/** 42703 undefined_column / PGRST204 schema-cache miss / message match. */
export function isMissingColumnError(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; message?: string; details?: string; hint?: string };
  if (e.code === "42703" || e.code === "PGRST204") return true;
  const text = [e.message, e.details, e.hint].filter(Boolean).join(" ");
  return /column .* does not exist|could not find .* column/i.test(text);
}

const PROPERTY_COLUMNS =
  "id, organization_id, building_key, rent_cents, beds, baths, sqft, available_date, unit_type, postal_code, description, furnished, air_conditioning, balcony, lease_term, pets_cats, pets_dogs, pets_dog_size, pets_notes, smoking, parking, parking_type, parking_count, heat_included, hydro_included, water_included, internet_included, cable_included, laundry, amenities, for_rent_by, ac_type, on_site_management";

type PropertyRow = Omit<PropertyForSheet, "question_sheet_completed_at" | "question_sheet_channels"> & {
  organization_id: string;
  building_key: string | null;
  for_rent_by: string | null;
  ac_type: string | null;
  on_site_management: boolean | null;
};

/**
 * The channels the sheet is built for: the active distribution run's portal
 * channels when one exists, else the default launch set (the same rule the
 * property page's packet card uses).
 *
 * DEVIATION (S692, recorded): spec section 1 wants "the channels the landlord
 * connected in Screen 1" (Slice 1 tile states linked / connected_needs_
 * authorization). Those states live in the 0225 session view, which is HELD
 * with 0226, so this loader cannot read them yet. Until Slice 1's tiles are
 * live, a landlord who linked only Kijiji is asked the Zumper and Rentals.ca
 * questions too, and question_sheet_channels is stamped with the launch set.
 * Swap this for the tile states once 0225 is applied; keep this as the fallback.
 */
export async function questionSheetChannelsFor(
  supabase: SupabaseClient,
  propertyId: string,
): Promise<string[]> {
  const { data: run } = await supabase
    .from("distribution_runs")
    .select("id")
    .eq("property_id", propertyId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (run?.id) {
    const { data: items } = await supabase
      .from("distribution_run_items")
      .select("channel")
      .eq("run_id", run.id as string)
      .order("created_at", { ascending: true });
    const fromRun = ((items ?? []) as { channel: string }[])
      .map((item) => item.channel)
      .filter(isPortalRequirementChannelKey);
    if (fromRun.length > 0) return fromRun;
  }
  return publishChannelChoices()
    .filter((meta) => meta.defaultSelected)
    .map((meta) => meta.key)
    .filter(isPortalRequirementChannelKey);
}

export async function loadQuestionSheet(
  supabase: SupabaseClient,
  args: {
    propertyId: string;
    org: OrgForSheetLoad;
    callerCanEditOrg: boolean;
    /** Override the channel rule (the wizard passes its selection). */
    channels?: readonly string[];
  },
): Promise<QuestionSheetLoad> {
  const { propertyId, org } = args;

  const { data: propertyData, error: propertyError } = await supabase
    .from("properties")
    .select(PROPERTY_COLUMNS)
    .eq("id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (propertyError) return { available: false, reason: "error", message: propertyError.message };
  if (!propertyData) return { available: false, reason: "not_found", message: "property not found in this organization" };
  const p = propertyData as unknown as PropertyRow;

  // 0226 columns, their own reads (spec 4.4 rule 2).
  const { data: sheetState, error: sheetError } = await supabase
    .from("properties")
    .select("question_sheet_completed_at, question_sheet_channels")
    .eq("id", propertyId)
    .maybeSingle();
  if (sheetError) {
    if (isMissingColumnError(sheetError)) {
      return { available: false, reason: "column_missing", message: sheetError.message };
    }
    return { available: false, reason: "error", message: sheetError.message };
  }
  const { data: orgState, error: orgError } = await supabase
    .from("organizations")
    .select("for_rent_by")
    .eq("id", org.id)
    .maybeSingle();
  if (orgError) {
    if (isMissingColumnError(orgError)) {
      return { available: false, reason: "column_missing", message: orgError.message };
    }
    return { available: false, reason: "error", message: orgError.message };
  }

  const { count: photoCount } = await supabase
    .from("property_photos")
    .select("id", { count: "exact", head: true })
    .eq("property_id", propertyId);

  // Policy inheritance, the same merge the property page does (unit > building > org).
  const orgProfile: PolicyProfile = {
    lease_term: org.policy_lease_term ?? null,
    smoking: org.policy_smoking ?? null,
    ac_type: org.policy_ac_type ?? null,
    on_site_management: org.policy_on_site_management ?? null,
    heat_included: org.policy_heat_included ?? null,
    hydro_included: org.policy_hydro_included ?? null,
    water_included: org.policy_water_included ?? null,
    pets_cats: org.policy_pets_cats ?? null,
    pets_dogs: org.policy_pets_dogs ?? null,
    pets_dog_size: org.policy_pets_dog_size ?? null,
  };
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
  const { features: effectiveFeatures } = resolveEffectiveFeatures(
    {
      lease_term: p.lease_term,
      smoking: p.smoking,
      ac_type: p.ac_type,
      on_site_management: p.on_site_management,
      pets_cats: p.pets_cats,
      pets_dogs: p.pets_dogs,
      pets_dog_size: p.pets_dog_size,
      heat_included: p.heat_included,
      hydro_included: p.hydro_included,
      water_included: p.water_included,
      internet_included: p.internet_included,
      cable_included: p.cable_included,
    },
    resolveBuildingProfile(buildingProfile, orgProfile),
  );

  const channels = args.channels ?? (await questionSheetChannelsFor(supabase, propertyId));

  const property: PropertyForSheet = {
    id: p.id,
    rent_cents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    sqft: p.sqft,
    available_date: p.available_date,
    unit_type: p.unit_type,
    postal_code: p.postal_code,
    description: p.description,
    furnished: p.furnished,
    air_conditioning: p.air_conditioning,
    balcony: p.balcony,
    lease_term: p.lease_term,
    pets_cats: p.pets_cats,
    pets_dogs: p.pets_dogs,
    pets_dog_size: p.pets_dog_size,
    pets_notes: p.pets_notes,
    smoking: p.smoking,
    parking: p.parking,
    parking_type: p.parking_type,
    parking_count: p.parking_count,
    heat_included: p.heat_included,
    hydro_included: p.hydro_included,
    water_included: p.water_included,
    internet_included: p.internet_included,
    cable_included: p.cable_included,
    laundry: p.laundry,
    amenities: p.amenities,
    question_sheet_completed_at:
      (sheetState?.question_sheet_completed_at as string | null | undefined) ?? null,
    question_sheet_channels:
      (sheetState?.question_sheet_channels as string[] | null | undefined) ?? null,
  };
  const orgForSheet: OrgForSheet = {
    public_contact_phone: org.public_contact_phone,
    public_contact_email: org.public_contact_email,
    reply_to_email: org.reply_to_email,
    for_rent_by: (orgState?.for_rent_by as string | null | undefined) ?? null,
  };
  const input: QuestionSheetInput = {
    property,
    org: orgForSheet,
    photoCount: photoCount ?? 0,
    channels,
    effectiveFeatures,
    callerCanEditOrg: args.callerCanEditOrg,
  };
  return {
    available: true,
    input,
    sheet: buildQuestionSheet(input),
    propertyForRentBy: p.for_rent_by,
  };
}
