import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { statusLabel, type LeadStatus } from "@/lib/pipeline";
import {
  PROPERTY_STATUSES,
  propertyStatusLabel,
  propertyStatusHelp,
  propertyStatusBadge,
  isPublicBookable,
  isPubliclyVisible,
  normalizePropertyStatus,
} from "@/lib/listing-state";
import {
  PageHeader,
  StatusChip,
  leadStatusTone,
  EmptyState,
  IconTile,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { DescriptionGuide } from "@/components/description-guide";
import { BeforeYouPost } from "@/components/before-you-post";
import {
  updateProperty,
  publishProperty,
  duplicateProperty,
  blastPriceDrop,
  uploadPropertyPhotos,
  importPropertyPhotosFromUrls,
  setCoverPhoto,
  movePhoto,
  deletePhoto,
} from "../actions";
import {
  buildAllListingCopy,
  copyPortalLabel,
} from "@/lib/listing-copy";
import { ListingCopyCard } from "./listing-copy-card";
import { MarketingKitCard } from "./marketing-kit-card";
import { buildMarketingKit, qrFilename } from "@/lib/listing-marketing";
import { qrSvg } from "@/lib/qr-svg";
import { buildAllFillSheets } from "@/lib/listing-fill-sheet";
import { FillSheetCard } from "./fill-sheet-card";
import { DropboxFolderImport } from "./dropbox-folder-import";
import { buildShareReadiness } from "@/lib/share-readiness";
import { feedSignal } from "@/lib/rental-readiness";
import {
  sortPhotos,
  uploadErrorMessage,
} from "@/lib/photos";
import { importUrlErrorMessage } from "@/lib/image-url-import";
import { dropboxImportErrorMessage } from "@/lib/dropbox-import";
import {
  photoCapForPlan,
  storageUpsellNote,
  canUseListingMarketing,
} from "@/lib/billing";
import { CopyLink } from "./copy-link";
import {
  countEligible,
  blastOfferable,
  formatRentLabel,
} from "@/lib/price-drop";
import {
  LAUNDRY_OPTIONS,
  laundryLabel,
  DOG_SIZE_OPTIONS,
  dogSizeLabel,
  AC_TYPE_OPTIONS,
  acTypeLabel,
  SMOKING_OPTIONS,
  smokingLabel,
  LEASE_TERM_OPTIONS,
  leaseTermLabel,
} from "@/lib/property-features";
import {
  resolveEffectiveFeatures,
  resolveBuildingProfile,
  type PolicyProfile,
} from "@/lib/policy-profile";
import {
  listingPostErrorMessage,
  buildTrackedLink,
  countLeadsByPost,
  type PortalKey,
  type ListingPostStatus,
} from "@/lib/listing-distribution";
import {
  deriveRentalLifecycle,
  LIFECYCLE_STEPS,
  type LifecycleStep,
} from "@/lib/rental-lifecycle";
import { LifecycleRail } from "./lifecycle-rail";
import { deriveNextAction } from "@/lib/rental-next-action";
import { NextActionCard } from "./next-action-card";
import { CollapsibleSection } from "./collapsible-section";
import { TabbedSections, TabPanel } from "./tabbed-sections";
import {
  DISTRIBUTION_CHANNELS,
  computeChannelStatus,
} from "@/lib/distribution-channels";
import {
  buildRunSteps,
  runProgress,
  selectableRunChannels,
  type RunItemStatus,
} from "@/lib/distribution-run";
import { guardrailsForPortal } from "@/lib/listing-guardrails";
import { computeChannelAnalytics } from "@/lib/distribution-analytics";
import {
  scoreListing,
  fairHousingLint,
  missingDetails,
} from "@/lib/listing-quality";
import type { QaExpected } from "@/lib/post-publish-qa";
import {
  DistributeTab,
  type DistributeChannelCard,
  type DistributePostRow,
  type LaunchRunData,
  type ReplyInputs,
  type PartnerAccountView,
  type QualityView,
} from "./distribute-tab";
import { normalizePartnerStatus } from "@/lib/distribution-partner";
import type { RunItemView } from "./launch-run-panel";
import { DetectorsSection, type DetectorView } from "./detectors-section";
import { computeEolDate, detectorStatus, type DetectorType } from "@/lib/detector-eol";
import { EquipmentSection, type EquipmentView } from "./equipment-section";
import {
  computeEolDate as computeEquipmentEol,
  equipmentStatusFor,
  type EquipmentType,
} from "@/lib/equipment-eol";
import {
  AppliancesSection,
  type ApplianceView,
  type ConsumableView,
  type ApplianceReceiptView,
} from "./appliances-section";
import {
  warrantyExpiryDate,
  warrantyStatusFor,
  appliancePurchaseAnchor,
  consumableNextDue,
  consumableStatusFor,
  type ApplianceType,
} from "@/lib/appliance-care";
import { createDocumentDownloadUrls } from "@/lib/documents-server";
import {
  appliancePrefillFromQuery,
  pendingDocIdFromQuery,
  scanExpensePrefillFromQuery,
} from "@/lib/asset-capture";
import { localDateString } from "@/lib/leasing-snapshot";

export const dynamic = "force-dynamic";

// Inherit-hint helpers for the per-unit tri-state utilities/pets selects (0050).
// The empty option reads "Inherit (<building-effective value>)".
function boolToSelect(v: boolean | null | undefined): string {
  return v == null ? "" : v ? "true" : "false";
}
function utilInheritWord(v: boolean | null | undefined): string {
  return v == null ? "not set" : v ? "included" : "tenant pays";
}
function petInheritWord(v: boolean | null | undefined): string {
  return v == null ? "not set" : v ? "welcome" : "not welcome";
}

type Property = {
  id: string;
  address: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  parking: string | null;
  description: string | null;
  status: string;
  price_drop_pending_cents: number | null;
  available_date: string | null;
  virtual_tour_url: string | null;
  sqft: number | null;
  floor: string | null;
  laundry: string | null;
  air_conditioning: boolean;
  balcony: boolean;
  furnished: boolean;
  // Utilities + pets are now inheritable (0050); null = inherit building/org.
  pet_friendly: boolean | null;
  pets_cats: boolean | null;
  pets_dogs: boolean | null;
  pets_dog_size: string | null;
  pets_notes: string | null;
  heat_included: boolean | null;
  hydro_included: boolean | null;
  water_included: boolean | null;
  photos_ready: boolean;
  // Standard-policy per-unit overrides (0048); null = inherit org profile.
  lease_term: string | null;
  smoking: string | null;
  ac_type: string | null;
  on_site_management: boolean | null;
  // Generated building identity (0049); resolves the per-building override.
  building_key: string | null;
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  status: LeadStatus;
  price_drop_notified_cents: number | null;
  listing_post_id: string | null;
  created_at: string;
};

type ListingPostRow = {
  id: string;
  portal: PortalKey;
  label: string | null;
  url: string | null;
  status: ListingPostStatus;
  posted_on: string | null;
  notes: string | null;
};

type PhotoRow = {
  id: string;
  url: string;
  sort_order: number;
  is_cover: boolean;
};

export default async function PropertyDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: {
    saved?: string;
    // One-click Publish (B1): published=1 confirms the rental went Live;
    // publish=needs means the basics required to share aren't set yet.
    published?: string;
    publish?: string;
    blasted?: string;
    post?: string;
    pn?: string; // post-submit nonce that remounts the add-post form (form reset)
    posterr?: string;
    photos?: string;
    photoskipped?: string;
    photoerr?: string;
    duplicated?: string;
    imported?: string;
    tourerr?: string;
    // Appliance plate/receipt scan (S364): outcome + extracted prefill fields.
    scan?: string;
    sc_type?: string;
    sc_make?: string;
    sc_model?: string;
    sc_serial?: string;
    sc_year?: string;
    sc_warranty?: string;
    sc_clabel?: string;
    sc_cmonths?: string;
    // Receipt-scan expense fields (S366) + the log-as-expense outcome.
    sc_merchant?: string;
    sc_pdate?: string;
    sc_total?: string;
    scanexp?: string;
  };
}) {
  const supabase = createClient();
  const { data: property } = await supabase
    .from("properties")
    .select(
      "id, address, rent_cents, beds, baths, parking, description, status, price_drop_pending_cents, available_date, virtual_tour_url, sqft, floor, laundry, air_conditioning, balcony, furnished, pet_friendly, pets_cats, pets_dogs, pets_dog_size, pets_notes, heat_included, hydro_included, water_included, photos_ready, lease_term, smoking, ac_type, on_site_management, building_key",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!property) notFound();
  const p = property as Property;

  const { data: leads } = await supabase
    .from("leads")
    .select(
      "id, name, email, status, price_drop_notified_cents, listing_post_id, created_at",
    )
    .eq("property_id", p.id)
    .order("created_at", { ascending: false });
  const leadRows = (leads ?? []) as LeadRow[];

  const { data: posts } = await supabase
    .from("listing_posts")
    .select("id, portal, label, url, status, posted_on, notes")
    .eq("property_id", p.id)
    .order("created_at", { ascending: true });
  const postRows = (posts ?? []) as ListingPostRow[];
  const postCounts = countLeadsByPost(leadRows);

  const { data: photos } = await supabase
    .from("property_photos")
    .select("id, url, sort_order, is_cover")
    .eq("property_id", p.id);
  const photoRows = sortPhotos((photos ?? []) as PhotoRow[]);

  // Org-wide weekly viewing windows — one signal in the share-readiness check
  // below ("can a renter actually self-book a viewing once they land?").
  const { count: availabilityCount } = await supabase
    .from("availability_rules")
    .select("id", { count: "exact", head: true });

  // The unit's tenancy (active preferred, else most recent) — lets the
  // lifecycle rail's Lease/Tenanted steps deep-link into THIS unit's tenancy
  // rather than the cross-unit hub (S282, IA G8 fix).
  const { data: tenancyRows } = await supabase
    .from("tenancies")
    .select("id, status")
    .eq("property_id", p.id)
    .order("start_date", { ascending: false }); // most recent first
  // Prefer an active tenancy, then an upcoming one, else the most recent (ended).
  // An active/upcoming tenancy is what makes the Lease/Tenanted steps true — so
  // the rail can never say "not tenanted" while an active tenancy exists.
  const tenancyList =
    (tenancyRows as { id: string; status: string }[] | null) ?? [];
  const chosenTenancy =
    tenancyList.find((t) => t.status === "active") ??
    tenancyList.find((t) => t.status === "upcoming") ??
    tenancyList[0] ??
    null;
  const tenancyId = chosenTenancy?.id ?? null;
  const tenancyStatus =
    (chosenTenancy?.status as "upcoming" | "active" | "ended" | undefined) ??
    null;

  const eligibleCount = countEligible(leadRows, p.rent_cents);
  const showBlastCard = blastOfferable(
    p.price_drop_pending_cents,
    p.rent_cents,
    eligibleCount,
  );
  const blastedCount =
    searchParams.blasted != null ? Number(searchParams.blasted) : null;

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const publicUrl = host ? `${proto}://${host}/r/${p.id}` : `/r/${p.id}`;

  // Split "the /r page loads" from "this is safe to promote". Leased/paused
  // pages intentionally load as unavailable, but only available rentals can take
  // inquiries/bookings and therefore get copyable links, QR codes, or tracked
  // posting URLs.
  const normalizedStatus = normalizePropertyStatus(p.status);
  const publicPageIsBookable = isPublicBookable(normalizedStatus);
  const publicPageIsVisible = isPubliclyVisible(normalizedStatus);
  const publicPageShowsUnavailable =
    publicPageIsVisible && !publicPageIsBookable;
  const linkIsLive = publicPageIsBookable;
  const promotionGuard = linkIsLive
    ? null
    : normalizedStatus === "leased"
      ? {
          title: "This rental is leased.",
          intro:
            "Keep this wording for reference or relisting; relist the rental as Live before you post it again.",
          body:
            "The copy below does not include your public listing link, and the rental can't take inquiries or viewing bookings while it is leased.",
          kitBody:
            "Relist it as Live before sharing a public link, QR code, or bundled channel copy.",
          missingLinkText:
            "Relist this rental as Live before adding a public listing link.",
          copyFallbackCta:
            "This rental is leased and is not accepting inquiries.",
          postingBody:
            "Past post history can stay here for reporting, but tracked sharing is off while the rental is leased.",
        }
      : normalizedStatus === "paused"
        ? {
            title: "This rental is paused.",
            intro:
              "Keep this wording ready; set the rental Live again before you post it.",
            body:
              "The copy below does not include your public listing link, and the rental can't take inquiries or viewing bookings while it is paused.",
            kitBody:
              "Set it Live again before sharing a public link, QR code, or bundled channel copy.",
            missingLinkText:
              "Set this paused rental Live again before adding a public listing link.",
            copyFallbackCta:
              "This rental is paused and is not accepting inquiries right now.",
            postingBody:
              "Past post history can stay here for reporting, but tracked sharing is off while the rental is paused.",
          }
        : {
            title: "This rental isn't live yet.",
            intro:
              "Prepare it now; use Publish at the top of the page before you post it.",
            body:
              "You can prepare and copy this wording now, but it doesn't include your public listing link and the rental can't take inquiries - use Publish at the top of the page before you post it anywhere.",
            kitBody:
              "Use Publish at the top of the page to get your public link and QR code; the channel wording below is ready to prepare now.",
            missingLinkText:
              "Set this rental Live to include your public listing link.",
            copyFallbackCta: "Contact us for availability details.",
            postingBody:
              "Set this rental Live before adding posts or sharing tracked links.",
          };

  // Ready-to-paste per-channel listing copy, built from this unit's real fields.
  // Omit the public link entirely for a non-bookable rental so the generated copy
  // never embeds a dead or unavailable URL; closed statuses get a safe fallback
  // line that does not invite bookings.
  const org = await getCurrentOrg();

  // Detector inventory (S359): this unit's logged smoke/CO detectors + each one's
  // computed end-of-life date + status (against the org-local "today"). Shaped
  // here so the section component stays presentational. RLS scopes the read.
  const { data: detectorRows } = await supabase
    .from("unit_detectors")
    .select(
      "id, detector_type, location, install_date, install_year, service_life_years, quantity, notes",
    )
    .eq("property_id", params.id)
    .order("created_at", { ascending: true });
  const detectorToday = localDateString(
    Date.now(),
    org?.booking_timezone || "America/Toronto",
  );
  const detectorViews: DetectorView[] = ((detectorRows ?? []) as any[]).map((r) => {
    const input = {
      detector_type: r.detector_type as DetectorType,
      install_date: r.install_date ?? null,
      install_year: r.install_year ?? null,
      service_life_years: r.service_life_years ?? null,
    };
    const eolDate = computeEolDate(input);
    return {
      id: r.id,
      detector_type: r.detector_type as DetectorType,
      location: r.location ?? null,
      install_date: r.install_date ?? null,
      install_year: r.install_year ?? null,
      service_life_years: r.service_life_years ?? null,
      quantity: r.quantity ?? 1,
      notes: r.notes ?? null,
      eolDate,
      status: detectorStatus(eolDate, detectorToday),
    };
  });
  const detectorAttention = detectorViews.filter(
    (d) => d.status === "overdue" || d.status === "due_soon",
  ).length;

  // Major-equipment inventory (S361): this unit's logged water heaters / furnaces
  // + each one's computed end-of-life date + status (against the org-local
  // "today", using the per-type lead window). Shaped here so the section
  // component stays presentational. RLS scopes the read.
  const { data: equipmentRows } = await supabase
    .from("unit_equipment")
    .select(
      "id, equipment_type, location, install_date, install_year, service_life_years, quantity, notes",
    )
    .eq("property_id", params.id)
    .order("created_at", { ascending: true });
  const equipmentViews: EquipmentView[] = ((equipmentRows ?? []) as any[]).map((r) => {
    const input = {
      equipment_type: r.equipment_type as EquipmentType,
      install_date: r.install_date ?? null,
      install_year: r.install_year ?? null,
      service_life_years: r.service_life_years ?? null,
    };
    return {
      id: r.id,
      equipment_type: r.equipment_type as EquipmentType,
      location: r.location ?? null,
      install_date: r.install_date ?? null,
      install_year: r.install_year ?? null,
      service_life_years: r.service_life_years ?? null,
      quantity: r.quantity ?? 1,
      notes: r.notes ?? null,
      eolDate: computeEquipmentEol(input),
      status: equipmentStatusFor(input, detectorToday),
    };
  });
  const equipmentAttention = equipmentViews.filter(
    (d) => d.status === "overdue" || d.status === "due_soon",
  ).length;

  // Appliance inventory (S362): this unit's logged appliances + each one's
  // warranty-expiry date + status (against the org-local "today"). Shaped here so
  // the section stays presentational. RLS scopes the read. S389: recurring
  // consumables moved to their own child table (appliance_consumables) and are
  // attached below.
  const { data: applianceRows } = await supabase
    .from("unit_appliances")
    .select(
      "id, appliance_type, make, model, serial, location, purchase_date, install_year, quantity, " +
        "warranty_months, notes",
    )
    .eq("property_id", params.id)
    .order("created_at", { ascending: true });
  const applianceViews: ApplianceView[] = ((applianceRows ?? []) as any[]).map((r) => {
    const input = {
      purchase_date: r.purchase_date ?? null,
      install_year: r.install_year ?? null,
      warranty_months: r.warranty_months ?? null,
    };
    return {
      id: r.id,
      appliance_type: r.appliance_type as ApplianceType,
      make: r.make ?? null,
      model: r.model ?? null,
      serial: r.serial ?? null,
      location: r.location ?? null,
      purchase_date: r.purchase_date ?? null,
      install_year: r.install_year ?? null,
      quantity: r.quantity ?? 1,
      warranty_months: r.warranty_months ?? null,
      notes: r.notes ?? null,
      warrantyExpiry: warrantyExpiryDate(input),
      warrantyStatus: warrantyStatusFor(input, detectorToday),
      consumables: [] as ConsumableView[],
      receipts: [] as ApplianceReceiptView[],
    };
  });

  // Consumables (S389): each appliance's recurring consumables live in the child
  // table (appliance_consumables, 0096). One query for all of this unit's
  // appliances; compute each row's next-due (falling back to the appliance's
  // purchase anchor) + status, then attach to its appliance view.
  if (applianceViews.length > 0) {
    const applianceById = new Map(applianceViews.map((a) => [a.id, a]));
    const { data: consumableRows } = await supabase
      .from("appliance_consumables")
      .select("id, appliance_id, label, interval_months, anchor_date, notes")
      .in(
        "appliance_id",
        applianceViews.map((a) => a.id),
      )
      .order("created_at", { ascending: true });
    for (const c of (consumableRows ?? []) as any[]) {
      const appliance = applianceById.get(c.appliance_id);
      if (!appliance) continue;
      const fallbackAnchor = appliancePurchaseAnchor({
        purchase_date: appliance.purchase_date,
        install_year: appliance.install_year,
      });
      const cInput = {
        interval_months: c.interval_months ?? null,
        anchor_date: c.anchor_date ?? null,
      };
      appliance.consumables.push({
        id: c.id,
        label: c.label ?? "",
        interval_months: c.interval_months ?? null,
        anchor_date: c.anchor_date ?? null,
        notes: c.notes ?? null,
        due: consumableNextDue(cInput, fallbackAnchor),
        status: consumableStatusFor(cInput, fallbackAnchor, detectorToday),
      });
    }
  }

  // Receipts (S363): the purchase proof for each appliance lives in the document
  // vault (documents.appliance_id, 0083) — the private bucket, so each row needs a
  // short-lived SIGNED URL minted server-side. One query for all of this unit's
  // appliances, one batched signed-URL mint, then attach to each appliance view.
  if (applianceViews.length > 0) {
    const { data: receiptRows } = await supabase
      .from("documents")
      .select("id, appliance_id, title, mime_type, storage_path, created_at")
      .in(
        "appliance_id",
        applianceViews.map((a) => a.id),
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: true });
    const receipts = (receiptRows ?? []) as {
      id: string;
      appliance_id: string | null;
      title: string;
      mime_type: string;
      storage_path: string;
      created_at: string;
    }[];
    if (receipts.length > 0) {
      const signed = await createDocumentDownloadUrls(
        supabase,
        receipts.map((r) => r.storage_path),
      );
      const urlByPath = new Map<string, string | null>();
      if (signed.ok) {
        for (const u of signed.urls) urlByPath.set(u.path, u.signedUrl);
      }
      const byAppliance = new Map<string, ApplianceReceiptView[]>();
      for (const r of receipts) {
        if (!r.appliance_id) continue;
        const list = byAppliance.get(r.appliance_id) ?? [];
        list.push({
          id: r.id,
          title: r.title,
          mime_type: r.mime_type,
          signedUrl: urlByPath.get(r.storage_path) ?? null,
        });
        byAppliance.set(r.appliance_id, list);
      }
      for (const a of applianceViews) {
        a.receipts = byAppliance.get(a.id) ?? [];
      }
    }
  }

  const applianceAttention = applianceViews.filter(
    (d) =>
      d.warrantyStatus === "overdue" ||
      d.warrantyStatus === "due_soon" ||
      d.consumables.some((c) => c.status === "overdue" || c.status === "due_soon"),
  ).length;

  // Standard-policy profile (0048 org defaults + 0049 per-building override):
  // resolve the building override AHEAD of the org default, then merge that UNDER
  // this unit's own values so the listing copy + per-portal fill sheets inherit
  // lease term / smoking / A/C type / on-site management without re-keying
  // (precedence: unit > building > org). The public /r page + syndication feed
  // apply the SAME merge server-side in get_public_listing / get_org_listing_feed.
  // `inheritedPolicy` records which fields came from the profile (vs the unit) so
  // the fill sheet labels them.
  const orgProfile: PolicyProfile | null = org
    ? {
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
      }
    : null;
  let buildingProfile: PolicyProfile | null = null;
  if (org && p.building_key) {
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
  // Building-over-org resolved into a single profile (forward-compat path).
  const policyProfile: PolicyProfile | null =
    orgProfile || buildingProfile
      ? resolveBuildingProfile(buildingProfile, orgProfile)
      : null;
  const { features: effectiveFeatures, inherited: inheritedPolicy } =
    resolveEffectiveFeatures(
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
      policyProfile,
    );
  const inheritedPolicyFields = [...inheritedPolicy];

  // The per-rental photo allowance is plan-scoped (Premium gets more); the
  // upsell note drives the soft "more room on a higher plan" badge.
  const photoCap = photoCapForPlan(org?.plan ?? null);
  const atPhotoLimit = photoRows.length >= photoCap;
  const storageUpsell = storageUpsellNote(org?.plan ?? null, photoRows.length);
  const copyTabs = buildAllListingCopy({
    businessName: org?.name ?? null,
    address: p.address,
    rentCents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    description: p.description,
    publicUrl: linkIsLive ? publicUrl : null,
    fallbackCta: promotionGuard?.copyFallbackCta,
    features: effectiveFeatures,
  }).map((c) => ({
    key: c.portal,
    label: copyPortalLabel(c.portal),
    title: c.title,
    body: c.body,
  }));
  // The channel copy is only as good as the description it's built from. Flag a
  // thin/empty one so the card can nudge the operator into the Description Helper
  // instead of shipping a field-summary ad.
  const descriptionThin = (p.description ?? "").trim().length < 40;

  // --- Marketing kit (S388, Tier A) ---------------------------------------
  // The paid promotion PACKAGE: bundle the per-channel copy + the public landing
  // link + a QR + a where-to-post checklist. Gated on listing_marketing (Growth+)
  // — the card renders a locked upsell for ungated plans, so we always build the
  // kit (cheap, pure) and let the entitlement decide what the card reveals.
  const marketingEnabled = canUseListingMarketing(org?.plan ?? null);
  const marketingLandingUrl = linkIsLive ? publicUrl : null;
  const marketingKit = buildMarketingKit({
    businessName: org?.name ?? null,
    address: p.address,
    landingUrl: marketingLandingUrl,
    missingLinkText: promotionGuard?.missingLinkText,
    channels: copyTabs,
  });
  // The QR encodes the public landing link; skip generation when unentitled or
  // not Live (no link to encode). qrSvg never throws (returns null on failure).
  const marketingQrSvg =
    marketingEnabled && marketingLandingUrl
      ? await qrSvg(marketingLandingUrl)
      : null;
  const marketingQrFilename = qrFilename(p.address);
  // Slice A2: the same aggregator-feed status the rentals list shows, surfaced
  // in the kit so the landlord sees this rental is already syndicating (or why
  // not). Reuses feedSignal — one source of truth. Only when entitled.
  const marketingFeedSignal = marketingEnabled
    ? feedSignal({
        status: p.status,
        rentCents: p.rent_cents,
        beds: p.beds,
        baths: typeof p.baths === "number" ? p.baths : null,
        address: p.address,
        description: p.description,
        photoCount: photoRows.length,
        availabilityWindowCount: 0,
      })
    : null;
  const marketingFeedStatus = marketingFeedSignal
    ? { inFeed: marketingFeedSignal.ok, hint: marketingFeedSignal.hint }
    : null;

  // Field-by-field "fill sheet" per portal (S262, syndication step 2). Same
  // listing input as the channel copy (title + body are reused from it), plus
  // the inquiry contact a couple of portals make you re-enter per listing
  // (Rentals.ca's Lead Contact). Built server-side; the card is presentational.
  const fillSheets = buildAllFillSheets({
    businessName: org?.name ?? null,
    address: p.address,
    rentCents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    description: p.description,
    publicUrl: linkIsLive ? publicUrl : null,
    leadContactEmail: org?.public_contact_email ?? org?.reply_to_email ?? null,
    leadContactPhone: org?.public_contact_phone ?? null,
    virtualTourUrl: p.virtual_tour_url,
    features: effectiveFeatures,
    inheritedPolicyFields,
  });

  // Share-readiness checklist (QA Should-Fix #5): before the operator pastes
  // the public link onto Kijiji/Facebook, surface what's in place and what's
  // still missing. Shown for the states where you'd be prepping/sharing a unit
  // (Draft / Live / Paused); a retired (Off market) or Leased unit is past this.
  const showReadiness =
    p.status === "draft" || p.status === "available" || p.status === "paused";
  const readiness = buildShareReadiness({
    status: p.status,
    rentCents: p.rent_cents,
    beds: p.beds,
    baths: p.baths,
    address: p.address,
    photoCount: photoRows.length,
    availabilityWindowCount: availabilityCount ?? 0,
    replyToEmail: org?.reply_to_email ?? null,
  });

  // --- Distribute command center (S412, Slice 1) --------------------------
  // Fold the per-channel copy + the where-posted tracker + share-readiness into
  // one channel-card model. Pure lib (lib/distribution-channels) decides the
  // status; here we just gather the inputs it needs. No new tables/actions.
  const distributeToday = detectorToday; // org-tz "today", already computed above
  // Listing-level, channel-agnostic blockers surfaced on every card. "live" is
  // injected by computeChannelStatus itself; viewing_times + reply_to are soft
  // recommendations, not per-channel blockers.
  const channelBlockers: string[] = [];
  for (const c of readiness.checks) {
    if (c.ok || c.key === "live") continue;
    if (c.key === "photos") channelBlockers.push("Add at least one photo");
    else if (c.key === "rent") channelBlockers.push("Set the monthly rent");
    else if (c.key === "beds_baths") channelBlockers.push("Add beds and baths");
    else if (c.key === "address") channelBlockers.push("Add the address");
  }
  const postsByPortal = new Map<PortalKey, ListingPostRow[]>();
  for (const post of postRows) {
    const arr = postsByPortal.get(post.portal) ?? [];
    arr.push(post);
    postsByPortal.set(post.portal, arr);
  }
  const toDistributePost = (post: ListingPostRow): DistributePostRow => ({
    id: post.id,
    status: post.status,
    label: post.label,
    url: post.url,
    posted_on: post.posted_on,
    notes: post.notes,
    trackedUrl: linkIsLive ? buildTrackedLink(publicUrl, post.id) : null,
    inquiryCount: postCounts.get(post.id) ?? 0,
  });
  const copyByKey = new Map(copyTabs.map((t) => [t.key, t]));
  // Org-level feed-partner accounts (Slice 3), keyed by channel.
  const { data: partnerRows } = await supabase
    .from("distribution_partner_accounts")
    .select(
      "channel, status, feed_url, partner_contact, submitted_on, accepted_on, last_checked_on, notes",
    );
  const partnerByChannel = new Map<string, PartnerAccountView>();
  for (const row of (partnerRows ?? []) as Array<{
    channel: string;
    status: string;
    feed_url: string | null;
    partner_contact: string | null;
    submitted_on: string | null;
    accepted_on: string | null;
    last_checked_on: string | null;
    notes: string | null;
  }>) {
    partnerByChannel.set(row.channel, {
      status: normalizePartnerStatus(row.status),
      feedUrl: row.feed_url,
      partnerContact: row.partner_contact,
      submittedOn: row.submitted_on,
      acceptedOn: row.accepted_on,
      lastCheckedOn: row.last_checked_on,
      notes: row.notes,
    });
  }
  const distributeChannelCards: DistributeChannelCard[] =
    DISTRIBUTION_CHANNELS.map((channel) => {
      const posts = (postsByPortal.get(channel.key) ?? []).map(toDistributePost);
      const status = computeChannelStatus({
        linkIsLive,
        blockers: channelBlockers,
        posts: posts.map((p) => ({
          status: p.status,
          url: p.url,
          posted_on: p.posted_on,
          inquiryCount: p.inquiryCount,
        })),
        today: distributeToday,
      });
      const copyTab = channel.copyKey ? copyByKey.get(channel.copyKey) : null;
      return {
        channel,
        status,
        copy: copyTab ? { title: copyTab.title, body: copyTab.body } : null,
        feed:
          channel.feedEligible && marketingFeedStatus
            ? { inFeed: marketingFeedStatus.inFeed, hint: marketingFeedStatus.hint }
            : null,
        partner: channel.feedEligible
          ? partnerByChannel.get(channel.key) ?? null
          : null,
        posts,
      };
    });
  const distributeOtherPosts = (postsByPortal.get("other") ?? []).map(
    toDistributePost,
  );

  // --- Guided launch run (S412 Slice 2) -----------------------------------
  const { data: activeRunRow } = await supabase
    .from("distribution_runs")
    .select("id")
    .eq("property_id", p.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  const activeRun = activeRunRow ? { id: activeRunRow.id as string } : null;
  type RunItemRow = {
    id: string;
    channel: string;
    status: RunItemStatus;
    external_url: string | null;
    notes: string | null;
    listing_post_id: string | null;
  };
  let runItemRows: RunItemRow[] = [];
  if (activeRun) {
    const { data: ri } = await supabase
      .from("distribution_run_items")
      .select("id, channel, status, external_url, notes, listing_post_id")
      .eq("run_id", activeRun.id)
      .order("created_at", { ascending: true });
    runItemRows = (ri ?? []) as RunItemRow[];
  }
  const channelLabelByKey = new Map<string, string>(
    DISTRIBUTION_CHANNELS.map((c) => [c.key, c.label]),
  );
  channelLabelByKey.set("other", "Other");
  const runItems: RunItemView[] = runItemRows.map((r) => ({
    id: r.id,
    channel: r.channel,
    channelLabel: channelLabelByKey.get(r.channel) ?? r.channel,
    status: r.status,
    externalUrl: r.external_url,
    trackedUrl:
      linkIsLive && r.listing_post_id
        ? buildTrackedLink(publicUrl, r.listing_post_id)
        : null,
    notes: r.notes,
    steps: buildRunSteps(r.channel, {
      guardrailCount: guardrailsForPortal(r.channel).length,
    }),
  }));
  const alreadyInRun = new Set(runItems.map((i) => i.channel));
  const launchRun: LaunchRunData = {
    run: activeRun,
    items: runItems,
    progress: runProgress(runItems),
    selectable: selectableRunChannels(DISTRIBUTION_CHANNELS, alreadyInRun),
    startChannels: selectableRunChannels(DISTRIBUTION_CHANNELS, new Set()),
  };
  const replyInputs: ReplyInputs = {
    address: p.address,
    bookingUrl: linkIsLive ? publicUrl : null,
    rentLabel: formatRentLabel(p.rent_cents),
  };
  // --- Listing quality (S412 Slice 5) -------------------------------------
  const hasFeatures = Object.values(
    (effectiveFeatures ?? {}) as Record<string, unknown>,
  ).some((v) => v !== null && v !== undefined && v !== false && v !== "");
  const listingQuality: QualityView = {
    listing: scoreListing({
      description: p.description,
      photoCount: photoRows.length,
      beds: p.beds,
      baths: typeof p.baths === "number" ? p.baths : null,
      rentCents: p.rent_cents,
      hasFeatures,
    }),
    fairFlags: fairHousingLint(p.description),
    missing: missingDetails(p.description),
  };
  // --- Post-publish QA expected values (S412 Slice 6) ---------------------
  const addressParts = p.address.split(",").map((s) => s.trim());
  const qaCity = addressParts.length >= 2 ? addressParts[1] : null;
  const qaExpected: QaExpected = {
    city: qaCity && /[a-z]/i.test(qaCity) ? qaCity : null,
    rentLabel: formatRentLabel(p.rent_cents),
    requireHydroDisclosure: true,
    requireUnfurnishedDisclosure: true,
    bookingUrl: linkIsLive ? publicUrl : null,
    phone: org?.public_contact_phone ?? null,
    email: org?.public_contact_email ?? org?.reply_to_email ?? null,
  };

  // --- Distribution analytics (S412 Slice 4) ------------------------------
  const distributionAnalytics = computeChannelAnalytics({
    leads: leadRows.map((l) => ({
      listing_post_id: l.listing_post_id,
      status: l.status,
    })),
    posts: postRows.map((post) => ({
      id: post.id,
      portal: post.portal,
      status: post.status,
      posted_on: post.posted_on,
    })),
    today: distributeToday,
  });

  // Status-aware guardrail for the share tools (S226 QA-audit): warn the
  // operator before they hand out a link that won't behave the way they expect.
  //   available           -> fully bookable, no notice
  //   paused / leased      -> /r LOADS but says "not available" (caution)
  //   draft / off_market   -> /r 404s, the link is broken (warning)
  const shareNotice = publicPageIsBookable
    ? null
    : publicPageIsVisible
      ? {
          tone: "caution" as const,
          text:
            normalizedStatus === "leased"
              ? "This rental is marked Leased. The link still works, but anyone who opens it is told the unit is no longer available — they can't inquire or book a viewing."
              : "This rental is Paused. The link still works, but anyone who opens it is told the unit isn't currently available — they can't inquire or book a viewing.",
        }
      : {
          tone: "warning" as const,
          text: `This rental is a ${propertyStatusLabel(
            p.status,
          )}. Its public page isn't live yet — anyone you share the link with will hit a "not found" page. Use Publish at the top of the page before sharing.`,
        };

  // Lifecycle rail (IA Step 4 slice 1): derive where this unit sits, empty ->
  // leased, from data already fetched above. Pure — see lib/rental-lifecycle.
  const lifecycle = deriveRentalLifecycle(p.id, {
    propertyStatus: normalizedStatus,
    hasRent: (p.rent_cents ?? 0) > 0,
    bedsSet: p.beds != null,
    bathsSet: p.baths != null,
    photoCount: photoRows.length,
    listingPostCount: postRows.length,
    hasAvailability: (availabilityCount ?? 0) > 0,
    leadStatuses: leadRows.map((l) => l.status),
    tenancyId,
    tenancyStatus,
  });

  // Forward-derivation (IA Step 4 slice 3): the PRE-FILLED next action for the
  // current step. The setup/market cascade reflects which fields were inherited
  // from the building/org policy profile — the four 0048/0049 fields come from
  // resolveEffectiveFeatures' inherited set; the 0050 utilities/pets fields it
  // doesn't track, so derive their provenance here (unit value unset + an
  // effective value present = inherited). Pure logic in lib/rental-next-action.
  const inheritedNext = new Set<string>(inheritedPolicyFields);
  const markInherit = (
    key: string,
    unitVal: boolean | null | undefined,
    effVal: boolean | null | undefined,
  ) => {
    if (
      (unitVal === null || unitVal === undefined) &&
      effVal !== null &&
      effVal !== undefined
    )
      inheritedNext.add(key);
  };
  markInherit("heat_included", p.heat_included, effectiveFeatures.heat_included);
  markInherit("hydro_included", p.hydro_included, effectiveFeatures.hydro_included);
  markInherit("water_included", p.water_included, effectiveFeatures.water_included);
  const catsInherited =
    (p.pets_cats === null || p.pets_cats === undefined) &&
    effectiveFeatures.pets_cats != null;
  const dogsInherited =
    (p.pets_dogs === null || p.pets_dogs === undefined) &&
    effectiveFeatures.pets_dogs != null;
  if (catsInherited || dogsInherited) inheritedNext.add("pets");

  const nextAction = deriveNextAction({
    propertyId: p.id,
    currentStep: lifecycle.currentStep,
    hasRent: (p.rent_cents ?? 0) > 0,
    bedsSet: p.beds != null,
    bathsSet: p.baths != null,
    effective: {
      lease_term: effectiveFeatures.lease_term,
      smoking: effectiveFeatures.smoking,
      ac_type: effectiveFeatures.ac_type,
      on_site_management: effectiveFeatures.on_site_management,
      heat_included: effectiveFeatures.heat_included,
      hydro_included: effectiveFeatures.hydro_included,
      water_included: effectiveFeatures.water_included,
      pets_cats: effectiveFeatures.pets_cats,
      pets_dogs: effectiveFeatures.pets_dogs,
    },
    inherited: inheritedNext,
    isLive: publicPageIsBookable,
    photoCount: photoRows.length,
    channelCount: copyTabs.length,
    linkIsLive: publicPageIsBookable,
    listingPostCount: postRows.length,
    hasAvailability: (availabilityCount ?? 0) > 0,
    openInquiryCount: leadRows.filter(
      (l) =>
        l.status === "new" || l.status === "replied" || l.status === "contacted",
    ).length,
    applicantCount: leadRows.filter((l) => l.status === "applied").length,
  });

  // Slice 2 (S280): collapse the page down to the rail. The three on-page rail
  // steps each become a <details> section; open the one at the frontier so the
  // operator lands on the step they're working, the rest collapsed. The header
  // status mirrors the matching rail step's detail line for cohesion.
  const currentStep = lifecycle.currentStep;
  const currentIdx =
    currentStep == null
      ? LIFECYCLE_STEPS.length
      : LIFECYCLE_STEPS.indexOf(currentStep);
  const setUpOpen = currentStep === "set_up";
  const marketOpen = currentStep === "market";
  const inquiriesOpen = currentIdx >= LIFECYCLE_STEPS.indexOf("inquiries");
  const stepOf = (k: LifecycleStep) =>
    lifecycle.steps.find((s) => s.step === k);
  const setUpStep = stepOf("set_up");
  const marketStep = stepOf("market");
  // Default tab mirrors the prior default-open logic for the collapsibles; a
  // deep-link hash on load overrides it (handled inside TabbedSections).
  const defaultTab = setUpOpen
    ? "setup"
    : marketOpen
      ? "market"
      : inquiriesOpen
        ? "inquiries"
        : "market";

  return (
    <div>
      <Link
        href="/dashboard/properties"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        ← Rentals
      </Link>

      {searchParams.saved && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Changes saved.
        </p>
      )}

      {/* One-click Publish (B1): confirm the rental is now Live and point the
          operator straight at the link to share. */}
      {searchParams.published && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          <strong>Your rental is now Live.</strong> Its public listing page is
          open to renters - copy the link below to start sharing it.
        </p>
      )}

      {/* Publish blocked because the basics required to share aren't set yet. */}
      {searchParams.publish === "needs" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>Almost there.</strong> Add the rent and the bed and bath count
          on the Set up tab, then use Publish again to make this rental Live.
        </p>
      )}

      {/* Publish blocked by the plan's live-listing allowance (Free = 1). */}
      {searchParams.publish === "plan" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>Free includes one live rental.</strong> Pause another rental to
          free up the spot, or{" "}
          <Link href="/dashboard/billing" className="font-semibold underline">
            choose Growth
          </Link>{" "}
          for unlimited live listings.
        </p>
      )}

      {/* From-scratch draft banner (M8): a quick-add lands as a private Draft,
          but only ?duplicated / ?imported got an explanatory banner. Explain the
          Draft state + how to publish for a plain quick-add too. */}
      {normalizedStatus === "draft" &&
        !searchParams.duplicated &&
        !searchParams.imported &&
        searchParams.publish !== "needs" && (
          <p className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-800">
            <strong>This rental is a private draft.</strong> Renters can&apos;t
            see it yet. Add the rent, bed and bath count, and a few photos, then
            use <strong>Publish</strong> (top of this page) to make its public
            listing page live.
          </p>
        )}

      {searchParams.duplicated && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Copied from another rental
          {Number(searchParams.duplicated) > 0
            ? `, including ${searchParams.duplicated} ${
                Number(searchParams.duplicated) === 1 ? "photo" : "photos"
              }`
            : ""}
          . Update the address and rent below, then set it Live when
          you&apos;re ready. It&apos;s saved as a Draft for now, so renters
          can&apos;t see it.
        </p>
      )}

      {searchParams.imported && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Prefilled{" "}
          {Number(searchParams.imported) > 0
            ? `${searchParams.imported} ${
                Number(searchParams.imported) === 1 ? "field" : "fields"
              } `
            : ""}
          from your pasted listing. Review everything below — especially the
          address, rent, and pet policy — then set it Live when it&apos;s right.
          It&apos;s saved as a Draft for now, so renters can&apos;t see it yet.
        </p>
      )}

      {/* Close the onboarding loop (S247): a paste from MLS / realtor.ca brings
          the text but never the photos, and portals like Kijiji and Facebook
          need photos to perform. Right after an import, point the operator
          straight at the photo uploader. */}
      {searchParams.imported && photoRows.length === 0 && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <strong>Next: add photos.</strong> Your pasted listing didn&apos;t
          include any — and listings with photos get far more inquiries on
          Kijiji, Facebook, and Zumper.{" "}
          <a href="#property-photos" className="font-medium underline">
            Add photos →
          </a>
        </p>
      )}

      {blastedCount != null && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {blastedCount > 0
            ? `Price-drop alert sent to ${blastedCount} ${
                blastedCount === 1 ? "renter" : "renters"
              }.`
            : "No renters were eligible for a price-drop alert."}
        </p>
      )}

      {searchParams.post && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {searchParams.post === "added"
            ? "Listing post added."
            : searchParams.post === "removed"
              ? "Listing post removed."
              : "Listing post saved."}
        </p>
      )}

      {searchParams.posterr && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {listingPostErrorMessage(searchParams.posterr)}
        </p>
      )}

      {searchParams.photos && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {searchParams.photos === "cover"
            ? "Cover photo updated."
            : searchParams.photos === "order"
              ? "Photo order updated."
              : searchParams.photos === "removed"
                ? "Photo removed."
                : `${searchParams.photos} ${
                    searchParams.photos === "1" ? "photo" : "photos"
                  } added.`}
          {searchParams.photoskipped && Number(searchParams.photoskipped) > 0
            ? ` ${searchParams.photoskipped} ${
                searchParams.photoskipped === "1" ? "item" : "items"
              } couldn't be imported — make sure links are direct, public images and any Dropbox folder is shared so anyone with the link can view.`
            : ""}
        </p>
      )}

      {searchParams.photoerr && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {searchParams.photoerr === "type" ||
          searchParams.photoerr === "size" ||
          searchParams.photoerr === "empty"
            ? uploadErrorMessage(searchParams.photoerr)
            : searchParams.photoerr.startsWith("url")
              ? importUrlErrorMessage(searchParams.photoerr)
              : searchParams.photoerr.startsWith("dropbox")
              ? dropboxImportErrorMessage(searchParams.photoerr)
              : searchParams.photoerr === "max"
                ? `You can add up to ${photoCap} photos per rental.`
                : searchParams.photoerr === "none"
                  ? "Please choose at least one photo to upload."
                  : "Sorry, the upload didn't go through. Please try again."}
        </p>
      )}

      <PageHeader
        icon={<Icons.building />}
        eyebrow="Rental"
        title={p.address}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${propertyStatusBadge(p.status).className}`}
            >
              {propertyStatusBadge(p.status).label}
            </span>
            {p.rent_cents ? (
              <span className="text-sm text-gray-500">
                ${(p.rent_cents / 100).toLocaleString()}/mo
              </span>
            ) : null}
            {/* One-click Publish (B1): the whole app says "set it Live" - this
                is the primary action that does it, so the operator never has to
                hunt for the Status dropdown. Shown only when the rental isn't
                already public and isn't leased. */}
            {!publicPageIsBookable && normalizedStatus !== "leased" && (
              <form action={publishProperty}>
                <input type="hidden" name="id" value={p.id} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                >
                  {normalizedStatus === "paused"
                    ? "Set Live again"
                    : "Publish rental"}
                </button>
              </form>
            )}
            <form action={duplicateProperty}>
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" className={SECONDARY_ACTION_CLASS}>
                Duplicate this rental
              </button>
            </form>
          </div>
        }
      />

      <LifecycleRail lifecycle={lifecycle} />

      {nextAction && <NextActionCard action={nextAction} />}

      <TabbedSections initialTab={defaultTab}>

      <TabPanel
        tabId="market"
        label="Photos & marketing"
        done={marketStep?.state === "done"}
      >

      <div
        id="share"
        className="mb-6 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile size="sm"><Icons.link className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Public listing link
          </h3>
        </div>
        <p className="mb-3 text-xs text-gray-500">
          {linkIsLive
            ? "Share this branded page on Kijiji, Facebook, and email. Inquiries land straight in your renter list."
            : publicPageShowsUnavailable
              ? "This public page can be previewed, but it tells renters the unit is unavailable and does not accept inquiries or viewing bookings."
            : "Once this rental is Live, its branded page can be shared on Kijiji, Facebook, and email and inquiries land straight in your renter list."}
        </p>
        {shareNotice && (
          <p
            className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
              shareNotice.tone === "warning"
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {shareNotice.text}
          </p>
        )}
        {/* Only expose Copy when the page is bookable. Leased/paused pages can be
            previewed as unavailable, but should not be handed out as inquiry links. */}
        {linkIsLive ? (
          <CopyLink url={publicUrl} />
        ) : publicPageShowsUnavailable ? (
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className={SECONDARY_ACTION_CLASS}
          >
            Open unavailable page -&gt;
          </a>
        ) : null}

        {showReadiness && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <div className="mb-2.5 flex items-center gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                Before you share
              </h4>
              {readiness.readyToShare ? (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                  Ready to share
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  {readiness.requiredOutstanding}{" "}
                  {readiness.requiredOutstanding === 1 ? "thing" : "things"} to
                  finish
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {readiness.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-2 text-xs">
                  <span
                    aria-hidden
                    className={`mt-px font-semibold ${
                      c.ok
                        ? "text-green-600"
                        : c.required
                          ? "text-amber-600"
                          : "text-gray-300"
                    }`}
                  >
                    {c.ok ? "✓" : "○"}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={
                        c.ok ? "text-gray-600" : "font-medium text-gray-900"
                      }
                    >
                      {c.label}
                    </span>
                    {!c.required && (
                      <span className="text-gray-400"> · recommended</span>
                    )}
                    {!c.ok && (
                      <span className="mt-0.5 block text-gray-500">
                        {c.hint}
                        {c.key === "photos" && (
                          <>
                            {" "}
                            <a
                              href="#property-photos"
                              className="font-medium text-brand underline"
                            >
                              Add photos →
                            </a>
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* --- Marketing kit (Tier A, Growth+) --- */}
      <MarketingKitCard
        locked={!marketingEnabled}
        notLive={!linkIsLive}
        notLiveTitle={promotionGuard?.title}
        notLiveBody={promotionGuard?.kitBody}
        landingUrl={marketingKit.landingUrl}
        qrSvg={marketingQrSvg}
        combinedText={marketingKit.combinedText}
        postChecklist={marketingKit.postChecklist}
        qrFilename={marketingQrFilename}
        feedStatus={marketingFeedStatus}
      />

      {/* --- Listing copy for each channel --- */}
      <ListingCopyCard
        tabs={copyTabs}
        descriptionThin={descriptionThin}
        notLive={!linkIsLive}
        notLiveIntro={promotionGuard?.intro}
        notLiveTitle={promotionGuard?.title}
        notLiveBody={promotionGuard?.body}
      />

      {/* --- Photos for this rental --- */}
      <div
        id="property-photos"
        className="mb-6 scroll-mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile size="sm"><Icons.page className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Photos for this rental
          </h3>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          Add photos renters will see on your listing page. The{" "}
          <strong>cover photo</strong> shows first. Drag isn&apos;t needed, just
          use the arrows to reorder. JPG, PNG, WebP, or GIF, up to 10&nbsp;MB each
          ({photoRows.length}/{photoCap}).
        </p>

        {photoRows.length === 0 ? (
          <div className="mb-4">
            <EmptyState
              icon={<Icons.page />}
              title="No photos yet"
              description="A listing with photos gets far more inquiries, so add a few below."
            />
          </div>
        ) : (
          <ul className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photoRows.map((photo, i) => (
              <li
                key={photo.id}
                className="overflow-hidden rounded-xl border border-gray-200"
              >
                <div className="relative aspect-[4/3] bg-gray-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  {photo.is_cover && (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold text-white">
                      Cover
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <form action={movePhoto}>
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button
                        type="submit"
                        disabled={i === 0}
                        aria-label="Move earlier"
                        className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ←
                      </button>
                    </form>
                    <form action={movePhoto}>
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button
                        type="submit"
                        disabled={i === photoRows.length - 1}
                        aria-label="Move later"
                        className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        →
                      </button>
                    </form>
                  </div>
                  <div className="flex items-center gap-1">
                    {!photo.is_cover && (
                      <form action={setCoverPhoto}>
                        <input type="hidden" name="property_id" value={p.id} />
                        <input type="hidden" name="photo_id" value={photo.id} />
                        <button
                          type="submit"
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-gray-100"
                        >
                          Set cover
                        </button>
                      </form>
                    )}
                    <form action={deletePhoto}>
                      <input type="hidden" name="property_id" value={p.id} />
                      <input type="hidden" name="photo_id" value={photo.id} />
                      <button
                        type="submit"
                        aria-label="Delete photo"
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </form>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Storage upsell (S248): a soft, non-blocking nudge once an operator is
            at or near their plan's photo allowance. We never block photo
            management here — we only point out that a higher plan has more room
            (two-axis visibility: show, don't block). Hidden on the top tier. */}
        {storageUpsell.showUpsell && (
          <p className="mb-3 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-gray-600">
            {storageUpsell.atCap
              ? `You're at your plan's ${storageUpsell.cap}-photo limit for this rental.`
              : `${storageUpsell.remaining} of ${storageUpsell.cap} photo slots left on this rental.`}{" "}
            <Link
              href="/dashboard/billing"
              className="font-medium text-brand underline"
            >
              Higher plans add more photos per rental →
            </Link>
          </p>
        )}

        {atPhotoLimit ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            You&apos;ve reached the {photoCap}-photo limit. Delete
            one to add another.
          </p>
        ) : (
          <div className="border-t border-gray-100 pt-3">
            <form
              action={uploadPropertyPhotos}
              className="flex flex-wrap items-center gap-3"
            >
              <input type="hidden" name="property_id" value={p.id} />
              <input
                id="photo-upload"
                type="file"
                name="photos"
                aria-label="Add photos to this rental"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                required
                className="block text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
              />
              <button
                type="submit"
                className={PRIMARY_ACTION_CLASS}
                style={{ backgroundColor: "var(--brand-color)" }}
              >
                Upload photos
              </button>
            </form>

            {/* Import from direct image links (item Q). After an MLS/realtor.ca
                paste, photos are the one step the text couldn't carry — so an
                operator who already has the images hosted somewhere can paste
                the links instead of saving + re-selecting files. We fetch each
                server-side (SSRF-guarded) and store it like an upload. */}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-brand">
                Or import from image links
              </summary>
              <form action={importPropertyPhotosFromUrls} className="mt-2">
                <input type="hidden" name="property_id" value={p.id} />
                <p className="mb-2 text-xs text-gray-500">
                  Paste one <strong>direct image link</strong> per line (each
                  should open the image itself — ending in .jpg, .png, .webp, or
                  .gif). Gallery pages and login-protected links won&apos;t work.
                </p>
                <textarea
                  name="photo_urls"
                  rows={4}
                  required
                  placeholder={
                    "https://example.com/photos/living-room.jpg\nhttps://example.com/photos/kitchen.jpg"
                  }
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
                <button
                  type="submit"
                  className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Import from links
                </button>
              </form>
            </details>

            {/* Import a whole gallery from a Dropbox shared folder (item Q,
                Phase 2). Operators file every photo/tour-vendor delivery into
                Dropbox, so a shared gallery/ folder link is the one source that
                works across all listings. We enumerate it server-side and pull
                each image — no Dropbox login needed on the operator's side. */}
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-brand">
                Or import from a Dropbox folder
              </summary>
              <DropboxFolderImport propertyId={p.id} />
            </details>
          </div>
        )}
      </div>

      {/* --- Posting reference (S412): the copy + fill sheet + gotchas live here
          as asset prep; WHERE the listing goes (channel cards + tracked posts)
          moved to the Distribute tab. --- */}
      <div className="mb-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile size="sm"><Icons.list className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold text-gray-900">
            Posting reference
          </h3>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          {linkIsLive
            ? "The field-by-field values and the per-portal gotchas to have open while you post. When you're ready to actually distribute this rental and track where it's live, head to the Distribute tab."
            : "Prepare your posting reference here. Posting and tracking turn on in the Distribute tab once this rental is Live and accepting inquiries."}
        </p>

        {!linkIsLive && promotionGuard && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="font-medium">{promotionGuard.title}</span>{" "}
            {promotionGuard.postingBody}
          </p>
        )}

        {/* Per-portal "before you post" gotcha checklist (S260). Content, not
            automation — the operator still posts by hand. */}
        {linkIsLive && <BeforeYouPost />}

        {/* Per-portal field-by-field fill sheet (S262). The values to paste into
            each portal's form, resolved from this rental, with the gotcha on
            each field. Still a reference — nothing is submitted. */}
        {linkIsLive && <FillSheetCard sheets={fillSheets} />}

        {/* Bridge to the Distribute command center (S412). */}
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">
              Ready to publish?
            </p>
            <p className="text-xs text-gray-600">
              Your copy, photos, and field sheet are here. The Distribute tab is
              where you post to each channel and track what&apos;s live.
            </p>
          </div>
          <a
            href="#distribute-header"
            className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--brand-color)" }}
          >
            Go to Distribute →
          </a>
        </div>
      </div>

      {showBlastCard && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="mb-1 text-sm font-semibold text-amber-900">
            Price dropped - notify past renters
          </h3>
          <p className="mb-3 text-xs text-amber-800">
            You reduced the rent from{" "}
            <span className="line-through">
              {formatRentLabel(p.price_drop_pending_cents)}
            </span>{" "}
            to <strong>{formatRentLabel(p.rent_cents)}</strong>.{" "}
            {eligibleCount} {eligibleCount === 1 ? "renter" : "renters"} who
            inquired earlier {eligibleCount === 1 ? "hasn't" : "haven't"} been
            told yet. Email them a branded alert with a link back to the listing.
          </p>
          <form action={blastPriceDrop}>
            <input type="hidden" name="id" value={p.id} />
            <button
              type="submit"
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              Notify {eligibleCount}{" "}
              {eligibleCount === 1 ? "renter" : "renters"} of the price drop
            </button>
          </form>
        </div>
      )}

      </TabPanel>

      <TabPanel
        tabId="distribute"
        label="Distribute"
        anchorId="distribute"
        done={distributeChannelCards.some(
          (c) =>
            c.status.value === "posted" || c.status.value === "needs_refresh",
        )}
      >
        <DistributeTab
          propertyId={p.id}
          linkIsLive={linkIsLive}
          addFormKey={String(searchParams.pn ?? "new")}
          today={distributeToday}
          readyToShare={readiness.readyToShare}
          requiredOutstanding={readiness.requiredOutstanding}
          channelCards={distributeChannelCards}
          otherPosts={distributeOtherPosts}
          promotionNote={promotionGuard?.postingBody ?? null}
          launchRun={launchRun}
          replyInputs={replyInputs}
          analytics={distributionAnalytics}
          quality={listingQuality}
          qaExpected={qaExpected}
        />
      </TabPanel>

      <TabPanel
        tabId="setup"
        label="Set up"
        anchorId="rental-details"
        done={setUpStep?.state === "done"}
      >

      <form
        action={updateProperty}
        className="mb-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <input type="hidden" name="id" value={p.id} />
        <div>
          <label
            htmlFor="property-address"
            className="mb-1 block text-xs font-medium text-gray-600"
          >
            Address
          </label>
          <input
            id="property-address"
            name="address"
            required
            defaultValue={p.address}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="w-32">
            <label
              htmlFor="property-rent"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Rent ($/mo)
            </label>
            <input
              id="property-rent"
              name="rent"
              type="number"
              step="0.01"
              defaultValue={p.rent_cents != null ? p.rent_cents / 100 : ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-20">
            <label
              htmlFor="property-beds"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Beds
            </label>
            <input
              id="property-beds"
              name="beds"
              type="number"
              step="1"
              defaultValue={p.beds ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-20">
            <label
              htmlFor="property-baths"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Baths
            </label>
            <input
              id="property-baths"
              name="baths"
              type="number"
              step="0.5"
              defaultValue={p.baths ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-40">
            <label
              htmlFor="property-parking"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Parking
            </label>
            <input
              id="property-parking"
              name="parking"
              defaultValue={p.parking ?? ""}
              placeholder="1 spot"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-40">
            <label
              htmlFor="property-status"
              className="mb-1 block text-xs font-medium text-gray-600"
            >
              Status
            </label>
            <select
              id="property-status"
              name="status"
              defaultValue={p.status}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              {PROPERTY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {propertyStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <details className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          <summary className="cursor-pointer font-medium text-gray-600">
            What each status means
          </summary>
          <ul className="mt-2 space-y-1.5">
            {PROPERTY_STATUSES.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-medium ${propertyStatusBadge(s).className}`}
                >
                  {propertyStatusLabel(s)}
                </span>
                <span>{propertyStatusHelp(s)}</span>
              </li>
            ))}
          </ul>
        </details>
        <div id="listing-description" className="scroll-mt-6">
        <DescriptionGuide
          defaultValue={p.description ?? ""}
          facts={{
            beds: p.beds,
            baths: p.baths,
            sqft: p.sqft,
            floor: p.floor,
            parking: p.parking,
            laundry: p.laundry,
            air_conditioning: p.air_conditioning,
            balcony: p.balcony,
            furnished: p.furnished,
            // Effective (inherited) utilities/pets so the description helper
            // reflects the unit's resolved policy, not a bare unset.
            pet_friendly: effectiveFeatures.pet_friendly,
            pets_cats: effectiveFeatures.pets_cats,
            pets_dogs: effectiveFeatures.pets_dogs,
            pets_dog_size: effectiveFeatures.pets_dog_size,
            pets_notes: p.pets_notes,
            heat_included: effectiveFeatures.heat_included,
            hydro_included: effectiveFeatures.hydro_included,
            water_included: effectiveFeatures.water_included,
            available_date: p.available_date,
            rent_cents: p.rent_cents,
          }}
        />
        </div>

        {/* --- Virtual tour / video link (item S) --- */}
        <div className="border-t border-gray-100 pt-4">
          <label
            htmlFor="virtual_tour_url"
            className="mb-1 block text-xs font-semibold uppercase tracking-wider text-gray-500"
          >
            Virtual tour / video URL{" "}
            <span className="font-normal normal-case tracking-normal text-gray-400">
              (optional)
            </span>
          </label>
          <input
            id="virtual_tour_url"
            name="virtual_tour_url"
            type="url"
            inputMode="url"
            defaultValue={p.virtual_tour_url ?? ""}
            placeholder="https://youriguide.com/… · YouTube · Vimeo · Matterport"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          {searchParams.tourerr === "host" ? (
            <p className="mt-1 text-xs text-amber-700">
              That link isn&apos;t from a supported tour host, so it wasn&apos;t
              saved. Use an iGUIDE, Matterport, YouTube, or Vimeo link.
            </p>
          ) : (
            <p className="mt-1 text-xs text-gray-400">
              Paste an iGUIDE, Matterport, YouTube, or Vimeo link. It embeds on
              your listing page and rides along to the portals.
            </p>
          )}
        </div>

        {/* --- Unit details --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Unit details
          </legend>
          <div className="flex flex-wrap gap-4">
            <div className="w-40">
              <label
                htmlFor="property-available-date"
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Available date
              </label>
              <input
                id="property-available-date"
                name="available_date"
                type="date"
                defaultValue={p.available_date ?? ""}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-400">Blank = available now</p>
            </div>
            <div className="w-28">
              <label
                htmlFor="property-sqft"
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Size (sq ft)
              </label>
              <input
                id="property-sqft"
                name="sqft"
                type="number"
                step="1"
                min="0"
                defaultValue={p.sqft ?? ""}
                placeholder="850"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-32">
              <label
                htmlFor="property-floor"
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Floor
              </label>
              <input
                id="property-floor"
                name="floor"
                defaultValue={p.floor ?? ""}
                placeholder="2nd"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="w-44">
              <label
                htmlFor="property-laundry"
                className="mb-1 block text-xs font-medium text-gray-600"
              >
                Laundry
              </label>
              <select
                id="property-laundry"
                name="laundry"
                defaultValue={p.laundry ?? ""}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Not specified</option>
                {LAUNDRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {laundryLabel(opt)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        {/* --- Amenities --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Amenities
          </legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {(
              [
                ["air_conditioning", "Air conditioning", p.air_conditioning],
                ["balcony", "Balcony", p.balcony],
                ["furnished", "Furnished", p.furnished],
              ] as const
            ).map(([name, label, checked]) => (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-2 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={checked}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {label}
              </label>
            ))}
          </div>

          {/* --- Pets (structured policy 0045; inheritable 0050) --- */}
          <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
            <p className="mb-2 text-xs font-medium text-gray-600">Pets welcome</p>
            <p className="mb-3 text-xs text-gray-400">
              Leave a field on &ldquo;Inherit&rdquo; to use your{" "}
              <Link
                href="/dashboard/properties/standard-policy"
                className="underline hover:text-gray-600"
              >
                standard pet policy
              </Link>
              ; set one here only if this unit differs.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">Cats</span>
                <select
                  name="pets_cats"
                  defaultValue={boolToSelect(p.pets_cats)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">
                    Inherit ({petInheritWord(policyProfile?.pets_cats)})
                  </option>
                  <option value="true">Welcome</option>
                  <option value="false">Not welcome</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">Dogs</span>
                <select
                  name="pets_dogs"
                  defaultValue={boolToSelect(p.pets_dogs)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">
                    Inherit ({petInheritWord(policyProfile?.pets_dogs)})
                  </option>
                  <option value="true">Welcome</option>
                  <option value="false">Not welcome</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-gray-600">
                  Dog size limit
                </span>
                <select
                  name="pets_dog_size"
                  defaultValue={p.pets_dog_size ?? ""}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">
                    Inherit ({dogSizeLabel(policyProfile?.pets_dog_size) ?? "no limit"})
                  </option>
                  {DOG_SIZE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {dogSizeLabel(opt)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label htmlFor="property-pets-notes" className="sr-only">
              Pet notes
            </label>
            <input
              id="property-pets-notes"
              name="pets_notes"
              defaultValue={p.pets_notes ?? ""}
              placeholder="Pet notes (optional), e.g. 1 pet max, no aggressive breeds"
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-400">
              Advertised pet preference for the listing and feed. In Ontario a
              &ldquo;no pets&rdquo; lease clause is void (RTA s.14) — this is a
              listing/screening field, not an enforceable rule.
            </p>
          </div>
        </fieldset>

        {/* --- Utilities included in rent (inheritable 0050) --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Utilities included in rent
          </legend>
          <p className="mb-3 text-xs text-gray-400">
            Leave a utility on &ldquo;Inherit&rdquo; to use your{" "}
            <Link
              href="/dashboard/properties/standard-policy"
              className="underline hover:text-gray-600"
            >
              standard policy
            </Link>
            ; pick &ldquo;Tenant pays&rdquo; only where this unit differs.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {(
              [
                ["heat_included", "Heat", p.heat_included, policyProfile?.heat_included],
                ["hydro_included", "Hydro", p.hydro_included, policyProfile?.hydro_included],
                ["water_included", "Water", p.water_included, policyProfile?.water_included],
              ] as const
            ).map(([name, label, value, inherited]) => (
              <label key={name} className="block">
                <span className="mb-1 block text-sm text-gray-600">{label}</span>
                <select
                  name={name}
                  defaultValue={boolToSelect(value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">
                    Inherit ({utilInheritWord(inherited)})
                  </option>
                  <option value="true">Included</option>
                  <option value="false">Tenant pays</option>
                </select>
              </label>
            ))}
          </div>
        </fieldset>

        {/* --- Standard policy (0048) — inherited from the building profile --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Standard policy
          </legend>
          <p className="mb-3 text-xs text-gray-400">
            These show the value this unit inherits from your{" "}
            <Link
              href="/dashboard/properties/standard-policy"
              className="underline hover:text-gray-600"
            >
              standard policy
            </Link>{" "}
            (building override, falling back to the organization default). Only
            change one here if THIS unit differs.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                Lease term
              </span>
              <select
                name="lease_term"
                defaultValue={p.lease_term ?? ""}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">
                  Inherit ({leaseTermLabel(policyProfile?.lease_term) ?? "1-year lease"})
                </option>
                {LEASE_TERM_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {leaseTermLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                Air conditioning
              </span>
              <select
                name="ac_type"
                defaultValue={p.ac_type ?? ""}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">
                  Inherit (
                  {acTypeLabel(policyProfile?.ac_type)
                    ? acTypeLabel(policyProfile?.ac_type)
                    : policyProfile?.ac_type === "none"
                      ? "no A/C"
                      : "not set"}
                  )
                </option>
                {AC_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === "none" ? "No air conditioning" : `A/C: ${acTypeLabel(opt)}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                Smoking
              </span>
              <select
                name="smoking"
                defaultValue={p.smoking ?? ""}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">
                  Inherit ({smokingLabel(policyProfile?.smoking) ?? "not set"})
                </option>
                {SMOKING_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {smokingLabel(opt)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                On-site management
              </span>
              <select
                name="on_site_management"
                defaultValue={
                  p.on_site_management == null
                    ? ""
                    : p.on_site_management
                      ? "true"
                      : "false"
                }
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">
                  Inherit (
                  {policyProfile?.on_site_management == null
                    ? "not set"
                    : policyProfile.on_site_management
                      ? "Yes"
                      : "No"}
                  )
                </option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
          </div>
        </fieldset>

        {/* --- Internal (operator-only) --- */}
        <fieldset className="border-t border-gray-100 pt-4">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Internal
          </legend>
          <p className="mb-3 text-xs text-gray-400">
            Not shown to renters.
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="photos_ready"
              defaultChecked={p.photos_ready}
              className="h-4 w-4 rounded border-gray-300"
            />
            Listing photos ready
          </label>
        </fieldset>

        <button
          type="submit"
          className={PRIMARY_ACTION_CLASS}
          style={{ backgroundColor: "var(--brand-color)" }}
        >
          Save changes
        </button>
      </form>

      </TabPanel>

      <TabPanel tabId="assets" label="Assets">

      <CollapsibleSection
        id="detectors"
        title="Detectors"
        status={
          detectorViews.length === 0
            ? "Not logged"
            : detectorAttention > 0
              ? `${detectorAttention} need attention`
              : `${detectorViews.length} logged`
        }
        done={detectorViews.length > 0 && detectorAttention === 0}
      >
        <DetectorsSection propertyId={p.id} detectors={detectorViews} />
      </CollapsibleSection>

      <CollapsibleSection
        id="equipment"
        title="Equipment"
        status={
          equipmentViews.length === 0
            ? "Not logged"
            : equipmentAttention > 0
              ? `${equipmentAttention} need attention`
              : `${equipmentViews.length} logged`
        }
        done={equipmentViews.length > 0 && equipmentAttention === 0}
      >
        <EquipmentSection propertyId={p.id} equipment={equipmentViews} />
      </CollapsibleSection>

      <CollapsibleSection
        id="appliances"
        title="Appliances"
        status={
          applianceViews.length === 0
            ? "Not logged"
            : applianceAttention > 0
              ? `${applianceAttention} need attention`
              : `${applianceViews.length} logged`
        }
        done={applianceViews.length > 0 && applianceAttention === 0}
      >
        <AppliancesSection
          propertyId={p.id}
          appliances={applianceViews}
          prefill={appliancePrefillFromQuery(searchParams)}
          pendingDocId={pendingDocIdFromQuery(searchParams)}
          scanStatus={searchParams.scan ?? null}
          scanExpense={scanExpensePrefillFromQuery(searchParams)}
          expenseStatus={searchParams.scanexp ?? null}
        />
      </CollapsibleSection>

      </TabPanel>

      <TabPanel
        tabId="inquiries"
        label="Inquiries"
        anchorId="inquiries"
        badge={leadRows.length}
        done={stepOf("inquiries")?.state === "done"}
      >

      {leadRows.length === 0 ? (
        <EmptyState
          icon={<Icons.users />}
          title="No inquiries yet"
          description={
            linkIsLive
              ? "Share the public listing link above to start collecting inquiries."
              : publicPageShowsUnavailable
                ? "This rental is not accepting inquiries in its current status. Set it Live again when you're ready for renters."
              : "Set this rental to Live (in the form above) to share its public link and start collecting inquiries."
          }
        />
      ) : (
        <>
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {leadRows.map((l) => (
            <li key={l.id}>
              <Link
                href={`/dashboard/leads/${l.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <span className="text-gray-900">
                  {l.name || l.email || "Unnamed renter"}
                </span>
                <StatusChip tone={leadStatusTone(l.status)}>
                  {statusLabel(l.status)}
                </StatusChip>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href={`/dashboard/leads?property=${p.id}`}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          View these in your inquiries list →
        </Link>
        </>
      )}

      </TabPanel>

      </TabbedSections>
    </div>
  );
}
