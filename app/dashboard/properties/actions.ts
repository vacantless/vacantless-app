"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { PROPERTY_STATUSES } from "@/lib/pipeline";
import { pendingDropFrom, leadEligibleForPriceDrop } from "@/lib/price-drop";
import { sendPriceDropAlert } from "@/lib/email";
import {
  normalizeLaundry,
  normalizeDogSize,
  normalizeLeaseTerm,
  normalizeSmoking,
  normalizeAcType,
} from "@/lib/property-features";
import { parseMlsListing } from "@/lib/mls-import";
import { normalizeVirtualTourUrl } from "@/lib/virtual-tour";
import {
  normalizePortal,
  normalizeListingStatus,
  normalizeUrl,
  normalizeText,
  normalizeDate,
  validateListingPost,
} from "@/lib/listing-distribution";
import {
  validatePhotoUpload,
  extForType,
  photoStoragePath,
  nextSortOrder,
  reorder,
  coverAfterDelete,
  planPhotoClone,
  MAX_PHOTO_BYTES,
  type PhotoLike,
  type SourcePhoto,
} from "@/lib/photos";
import {
  parseImageUrls,
  validateImageUrl,
  isBlockedAddress,
  sniffImageType,
} from "@/lib/image-url-import";
import {
  parseDropboxFolderUrl,
  sortGalleryEntries,
  groupImagesByParentPath,
  leafFolderSummaries,
  normalizeFolderChoice,
  dropboxFilePath,
  type DropboxEntry,
  type DropboxLeafFolder,
} from "@/lib/dropbox-import";
import { photoCapForPlan } from "@/lib/billing";
import { createHash } from "crypto";
import {
  validateDocumentUpload,
  documentStoragePath,
  defaultTitleFromFilename,
  extForType as documentExtForType,
} from "@/lib/documents";
import { DOCUMENTS_BUCKET, removeDocuments } from "@/lib/documents-server";
import { retentionUntil, pendingCaptureUntil } from "@/lib/document-retention";
import { parseAssetImage, isVisionImageType } from "@/lib/asset-capture-vision";
import { plateFieldsToQuery, normalizePendingDocId, type AssetDraft } from "@/lib/asset-capture";
import { validateExpenseInput } from "@/lib/expenses";
import { parseMoneyToCents } from "@/lib/tenancy";

const PHOTO_BUCKET = "property-photos";

function parseRentCents(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function parseIntOrNull(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(raw: string): number | null {
  const v = raw.trim();
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** A checkbox is present in FormData (value "on") only when checked. */
function parseCheckbox(formData: FormData, name: string): boolean {
  return formData.get(name) != null;
}

/**
 * A tri-state select: "true" -> true, "false" -> false, anything else (incl.
 * the empty "Inherit" option) -> null. Used by the standard-policy override
 * fields (0048) where null UNAMBIGUOUSLY means "inherit the org profile".
 */
function parseTriStateBool(formData: FormData, name: string): boolean | null {
  const raw = String(formData.get(name) ?? "").trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/** Normalize an HTML date input ("YYYY-MM-DD") to a value or null. */
function parseDateOrNull(raw: string): string | null {
  const v = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function addProperty(formData: FormData) {
  // Property management is admin/operator only (locked seat model): a showing
  // helper can't create/edit/delete units, listing posts, or photos.
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const address = String(formData.get("address") ?? "").trim();
  if (!address) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  // organization_id is taken from the caller's own org; RLS WITH CHECK also
  // enforces it must be an org they belong to — no cross-tenant write possible.
  //
  // status='draft' = PRIVATE until reviewed (Codex re-review P2, S371): a bare
  // quick-add (address + maybe rent/beds/baths, no photos, no description) is not
  // share-ready, so it must not land Live/public by inheriting the column
  // default ('available'). This matches the MLS-import path, which already lands
  // as a draft "so nothing goes public until the operator reviews". The operator
  // sets it Live from the edit form once the listing is complete.
  await supabase.from("properties").insert({
    organization_id: org.id,
    status: "draft",
    address,
    rent_cents: parseRentCents(String(formData.get("rent") ?? "")),
    beds: parseIntOrNull(String(formData.get("beds") ?? "")),
    baths: parseFloatOrNull(String(formData.get("baths") ?? "")),
  });

  revalidatePath("/dashboard/properties");
  revalidatePath("/dashboard");
  // Redirect (not just revalidate) so the add form REMOUNTS and its uncontrolled
  // inputs clear — otherwise the typed values linger and invite a duplicate
  // unit on the next submit (live QA finding S192). The `added` value is a fresh
  // NONCE each time: redirecting to the same route is a soft navigation, so React
  // reuses the form DOM and a CONSTANT flag (?added=1) would NOT reset the
  // uncontrolled inputs. The page keys the form on this value to force a remount
  // (S226 QA-audit fix: "Add rental form still retains submitted values").
  redirect(`/dashboard/properties?added=${Date.now().toString(36)}`);
}

/**
 * Realtor onboarding wedge (REAL-WORLD-INTAKE item M, S245): create a rental by
 * PASTING an existing MLS / realtor.ca listing instead of re-keying every field.
 *
 * Posture: the text comes from the OPERATOR (their own listing) and is parsed
 * locally by the PURE `parseMlsListing` — no scrape, no network call (same ToS
 * discipline as the syndication feed; the automated CREA/DDF pull is a separate
 * later increment). The import always lands as a DRAFT so nothing goes public
 * until the operator reviews the prefilled edit form and sets it Live. We carry
 * the count of prefilled fields forward as a review banner.
 *
 * Pets are deliberately NOT imported (the parser has no pet output): pets are an
 * RTA s.14 operator decision (S241), never inferred from listing prose.
 */
export async function importPropertyFromMls(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const pasted = String(formData.get("mls_text") ?? "");

  const parsed = parseMlsListing(pasted);
  // Nothing usable parsed out — send the operator back with a hint rather than
  // creating an empty draft they have to delete.
  if (parsed.foundFields.length === 0) {
    redirect("/dashboard/properties?import=empty");
  }

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();
  // organization_id is the caller's own org; RLS WITH CHECK re-enforces it.
  // status='draft' = private until reviewed. Address may be missing from the
  // paste; use a clear placeholder so the required column is satisfied and the
  // operator knows to fill it in on the review screen.
  const { data: inserted } = await supabase
    .from("properties")
    .insert({
      organization_id: org.id,
      status: "draft",
      address: parsed.address ?? "New rental — add the address",
      rent_cents: parsed.rentCents,
      beds: parsed.beds,
      baths: parsed.baths,
      sqft: parsed.sqft,
      parking: parsed.parking,
      description: parsed.description,
      available_date: parsed.availableDate,
      virtual_tour_url: parsed.virtualTourUrl,
      air_conditioning: parsed.airConditioning,
      balcony: parsed.balcony,
      furnished: parsed.furnished,
      laundry: parsed.laundry,
      heat_included: parsed.heatIncluded,
      hydro_included: parsed.hydroIncluded,
      water_included: parsed.waterIncluded,
    })
    .select("id")
    .single();

  revalidatePath("/dashboard/properties");
  revalidatePath("/dashboard");

  if (!inserted) {
    // Insert failed (e.g. an RLS/permission edge) — don't 500, send a message.
    redirect("/dashboard/properties?import=failed");
  }
  const id = (inserted as { id: string }).id;
  // Land on the edit page (the review surface) with the prefilled-field count.
  redirect(
    `/dashboard/properties/${id}?imported=${parsed.foundFields.length}`,
  );
}

export async function updateProperty(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const address = String(formData.get("address") ?? "").trim();
  if (!id || !address) return;

  const statusRaw = String(formData.get("status") ?? "available");
  const status = (PROPERTY_STATUSES as readonly string[]).includes(statusRaw)
    ? statusRaw
    : "available";

  const newRent = parseRentCents(String(formData.get("rent") ?? ""));

  const supabase = createClient();

  // Read the prior rent + pending price-drop state so we can record a genuine
  // reduction (and keep the highest "from" price across successive drops). RLS
  // scopes this to the caller's org.
  const { data: prior } = await supabase
    .from("properties")
    .select("rent_cents, price_drop_pending_cents")
    .eq("id", id)
    .maybeSingle();
  const oldRent = (prior as { rent_cents: number | null } | null)?.rent_cents ?? null;
  const existingPending =
    (prior as { price_drop_pending_cents: number | null } | null)
      ?.price_drop_pending_cents ?? null;
  const nextPending = pendingDropFrom(oldRent, newRent, existingPending);

  // Structured pet policy (0045), now inheritable (0050): cats/dogs are tri-state
  // (true / false / null = inherit the building/org standard policy). The stored
  // pet_friendly master is written best-effort here, but is NO LONGER the
  // authoritative read — the public RPCs + S240 screening RESOLVE it from the
  // effective (inherited) cats/dogs (coalesce unit > building > org). Dog size is
  // its own inheritable field (null = inherit).
  const petsCats = parseTriStateBool(formData, "pets_cats");
  const petsDogs = parseTriStateBool(formData, "pets_dogs");
  const petsDogSize = normalizeDogSize(formData.get("pets_dog_size"));
  const petsNotes = String(formData.get("pets_notes") ?? "").trim() || null;
  // Best-effort stored master: a definite yes if either is explicitly welcome, a
  // definite no if both are explicitly not, else null (inherit) — resolved at read.
  const petFriendly =
    petsCats === true || petsDogs === true
      ? true
      : petsCats === false && petsDogs === false
        ? false
        : null;

  // Virtual tour / video URL (item S). Validate against the host allow-list
  // (lib/virtual-tour) before storing; a blank clears it, a non-tour-host link
  // is rejected (stored as the prior value left untouched would surprise — we
  // store null and flag it so the operator sees why it didn't take).
  const tourRaw = String(formData.get("virtual_tour_url") ?? "").trim();
  const virtualTourUrl = tourRaw ? normalizeVirtualTourUrl(tourRaw) : null;
  const tourRejected = tourRaw !== "" && virtualTourUrl === null;

  // RLS scopes the update to the caller's org; .eq("id") targets one row.
  await supabase
    .from("properties")
    .update({
      address,
      rent_cents: newRent,
      beds: parseIntOrNull(String(formData.get("beds") ?? "")),
      baths: parseFloatOrNull(String(formData.get("baths") ?? "")),
      parking: String(formData.get("parking") ?? "").trim() || null,
      description: String(formData.get("description") ?? "").trim() || null,
      status,
      price_drop_pending_cents: nextPending,
      // Unit-level fields
      available_date: parseDateOrNull(String(formData.get("available_date") ?? "")),
      virtual_tour_url: virtualTourUrl,
      sqft: parseIntOrNull(String(formData.get("sqft") ?? "")),
      floor: String(formData.get("floor") ?? "").trim() || null,
      laundry: normalizeLaundry(formData.get("laundry")),
      air_conditioning: parseCheckbox(formData, "air_conditioning"),
      balcony: parseCheckbox(formData, "balcony"),
      furnished: parseCheckbox(formData, "furnished"),
      pet_friendly: petFriendly,
      pets_cats: petsCats,
      pets_dogs: petsDogs,
      pets_dog_size: petsDogSize,
      pets_notes: petsNotes,
      // Utilities tri-state (0050): true / false / null = inherit.
      heat_included: parseTriStateBool(formData, "heat_included"),
      hydro_included: parseTriStateBool(formData, "hydro_included"),
      water_included: parseTriStateBool(formData, "water_included"),
      photos_ready: parseCheckbox(formData, "photos_ready"),
      // Standard-policy per-unit overrides (0048); null = inherit org profile.
      lease_term: normalizeLeaseTerm(formData.get("lease_term")),
      smoking: normalizeSmoking(formData.get("smoking")),
      ac_type: normalizeAcType(formData.get("ac_type")),
      on_site_management: parseTriStateBool(formData, "on_site_management"),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${id}`);
  revalidatePath("/dashboard/properties");
  redirect(
    `/dashboard/properties/${id}?saved=1${tourRejected ? "&tourerr=host" : ""}`,
  );
}

/**
 * Duplicate a rental: clone the property row + all of its 0013 unit-feature
 * fields into a NEW row so an operator with several near-identical units (e.g.
 * units in the same building) doesn't re-enter every amenity/utility flag.
 *
 * The clone is created as a DRAFT (private, not yet published) and its address
 * is prefixed "Copy of " so a half-edited duplicate never goes public with the
 * wrong address. We deliberately do NOT copy
 * per-listing event/relationship state: price-drop flags, photos, listing posts,
 * leads, or showings — only the unit's own descriptive fields. Redirect-based
 * (dodges the 503 WATCH on revalidate-only server actions, S170).
 */
export async function duplicateProperty(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();

  // RLS scopes this read to the caller's org, so a foreign id returns nothing.
  const { data: source } = await supabase
    .from("properties")
    .select(
      "address, rent_cents, beds, baths, parking, description, available_date, virtual_tour_url, sqft, floor, laundry, air_conditioning, balcony, furnished, pet_friendly, pets_cats, pets_dogs, pets_dog_size, pets_notes, heat_included, hydro_included, water_included, photos_ready, lease_term, smoking, ac_type, on_site_management",
    )
    .eq("id", id)
    .maybeSingle();

  if (!source) redirect("/dashboard/properties");
  const s = source as {
    address: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    parking: string | null;
    description: string | null;
    available_date: string | null;
    virtual_tour_url: string | null;
    sqft: number | null;
    floor: string | null;
    laundry: string | null;
    air_conditioning: boolean;
    balcony: boolean;
    furnished: boolean;
    // Utilities + pets are inheritable (0050); null = inherit, carried as-is.
    pet_friendly: boolean | null;
    pets_cats: boolean | null;
    pets_dogs: boolean | null;
    pets_dog_size: string | null;
    pets_notes: string | null;
    heat_included: boolean | null;
    hydro_included: boolean | null;
    water_included: boolean | null;
    photos_ready: boolean;
    lease_term: string | null;
    smoking: string | null;
    ac_type: string | null;
    on_site_management: boolean | null;
  };

  const { data: inserted } = await supabase
    .from("properties")
    .insert({
      organization_id: org.id,
      address: `Copy of ${s.address}`,
      rent_cents: s.rent_cents,
      beds: s.beds,
      baths: s.baths,
      parking: s.parking,
      description: s.description,
      status: "draft", // a real private Draft until the operator sets it Live
      available_date: s.available_date,
      virtual_tour_url: s.virtual_tour_url,
      sqft: s.sqft,
      floor: s.floor,
      laundry: s.laundry,
      air_conditioning: s.air_conditioning,
      balcony: s.balcony,
      furnished: s.furnished,
      pet_friendly: s.pet_friendly,
      pets_cats: s.pets_cats,
      pets_dogs: s.pets_dogs,
      pets_dog_size: s.pets_dog_size,
      pets_notes: s.pets_notes,
      heat_included: s.heat_included,
      hydro_included: s.hydro_included,
      water_included: s.water_included,
      // Carry the per-unit policy overrides too — a duplicate is almost always a
      // same-building unit, so its standard-policy exceptions (if any) match.
      lease_term: s.lease_term,
      smoking: s.smoking,
      ac_type: s.ac_type,
      on_site_management: s.on_site_management,
      // photos_ready is reconciled below once we know how many photos copied.
      photos_ready: false,
    })
    .select("id")
    .maybeSingle();

  const newId = (inserted as { id: string } | null)?.id;
  if (!newId) {
    revalidatePath("/dashboard/properties");
    revalidatePath("/dashboard");
    redirect("/dashboard/properties");
  }

  // Carry the source listing's photos onto the clone. A duplicated rental is
  // almost always a near-identical unit in the same building (the realtor ICP's
  // common case), so re-uploading the same photo set is pure friction. We COPY
  // the storage objects server-side (no download) and re-insert rows, preserving
  // display order and the cover. RLS scopes the read to the caller's org.
  const { data: srcPhotos } = await supabase
    .from("property_photos")
    .select("id, storage_path, sort_order, is_cover")
    .eq("property_id", id);
  const sourcePhotos = (srcPhotos ?? []) as SourcePhoto[];

  let clonedCount = 0;
  if (sourcePhotos.length > 0) {
    const plan = planPhotoClone(
      sourcePhotos,
      org.id,
      newId,
      () => crypto.randomUUID(),
    );
    for (const c of plan) {
      const { error: copyErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .copy(c.fromPath, c.toPath);
      if (copyErr) continue; // best-effort: skip a failed copy, keep going

      const {
        data: { publicUrl },
      } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(c.toPath);

      const { error: insErr } = await supabase.from("property_photos").insert({
        id: c.newId,
        organization_id: org.id,
        property_id: newId,
        storage_path: c.toPath,
        url: publicUrl,
        sort_order: c.sort_order,
        is_cover: c.is_cover,
      });
      if (insErr) {
        // Roll back the orphaned copy so Storage and the table stay in sync.
        const { error: rbErr } = await supabase.storage
          .from(PHOTO_BUCKET)
          .remove([c.toPath]);
        if (rbErr) {
          console.error("duplicateProperty: rollback remove failed", {
            path: c.toPath,
            error: rbErr.message,
          });
        }
        continue;
      }
      clonedCount += 1;
    }

    // Inherit the source's photos-ready flag only if EVERY photo came across —
    // a partial copy leaves the clone unverified, so the operator re-confirms.
    if (clonedCount > 0 && clonedCount === sourcePhotos.length && s.photos_ready) {
      await supabase
        .from("properties")
        .update({ photos_ready: true })
        .eq("id", newId);
    }
  }

  revalidatePath("/dashboard/properties");
  revalidatePath("/dashboard");

  // Land the operator on the clone's edit page so they fix the address + rent;
  // the count drives the banner ("…including N photos").
  redirect(`/dashboard/properties/${newId}?duplicated=${clonedCount}`);
}

/**
 * Price-drop blast: email every still-open lead on a property that the rent has
 * dropped, inviting them back to the public listing. Recomputes eligibility
 * server-side (never trusts the client), sends best-effort branded emails, logs
 * each to the lead timeline, stamps the lead so a repeat run is a no-op, then
 * clears the property's pending-drop flag. Redirect-based (dodges the 503 WATCH
 * on revalidate-only server actions).
 */
export async function blastPriceDrop(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();

  const { data: property } = await supabase
    .from("properties")
    .select("id, address, rent_cents, price_drop_pending_cents")
    .eq("id", id)
    .maybeSingle();

  const p = property as {
    id: string;
    address: string | null;
    rent_cents: number | null;
    price_drop_pending_cents: number | null;
  } | null;

  // Nothing to announce unless there's a recorded drop below the current rent.
  if (
    !p ||
    p.rent_cents == null ||
    p.price_drop_pending_cents == null ||
    p.price_drop_pending_cents <= p.rent_cents
  ) {
    redirect(`/dashboard/properties/${id}?blasted=0`);
  }

  const { data: leads } = await supabase
    .from("leads")
    .select("id, name, email, status, price_drop_notified_cents")
    .eq("property_id", id);

  const leadRows = (leads ?? []) as Array<{
    id: string;
    name: string | null;
    email: string | null;
    status: string;
    price_drop_notified_cents: number | null;
  }>;

  let sent = 0;
  for (const lead of leadRows) {
    if (
      !leadEligibleForPriceDrop(
        {
          email: lead.email,
          status: lead.status,
          price_drop_notified_cents: lead.price_drop_notified_cents,
        },
        p.rent_cents,
      )
    ) {
      continue;
    }

    const result = await sendPriceDropAlert({
      lead_id: lead.id,
      property_id: p.id,
      renter_name: lead.name,
      renter_email: lead.email,
      org_name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: org.reply_to_email,
      property_address: p.address,
      new_rent_cents: p.rent_cents,
      old_rent_cents: p.price_drop_pending_cents,
    });

    if (!result.sent) continue; // best-effort: skip; the lead stays eligible

    // Stamp the lead so a re-run never double-sends, then log the timeline.
    await supabase
      .from("leads")
      .update({ price_drop_notified_cents: p.rent_cents })
      .eq("id", lead.id);

    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: lead.id,
      channel: "email",
      direction: "outbound",
      body:
        `Price-drop alert sent to ${lead.email}` +
        (result.subject ? ` — "${result.subject}"` : ""),
    });

    sent++;
  }

  // Clear the pending-drop flag so the blast card retires.
  await supabase
    .from("properties")
    .update({ price_drop_pending_cents: null })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${id}`);
  revalidatePath("/dashboard/leads");
  redirect(`/dashboard/properties/${id}?blasted=${sent}`);
}

// ===========================================================================
// Listing distribution — record where a property is posted (one property -> many
// portal posts). Each post yields a tracked inquiry link so an arriving renter
// is attributed to the right channel. All three actions are redirect-based to
// dodge the 503 WATCH on revalidate-only server actions (see S170). RLS scopes
// every write to the caller's org; the FK + check constraints are the backstop.
// ===========================================================================

export async function addListingPost(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const portal = normalizePortal(formData.get("portal"));
  const status = normalizeListingStatus(formData.get("status"));
  const url = normalizeUrl(formData.get("url"));
  const check = validateListingPost({ portal, status, url });
  if (!check.ok) {
    redirect(`/dashboard/properties/${propertyId}?posterr=${check.code}`);
  }

  const supabase = createClient();
  await supabase.from("listing_posts").insert({
    organization_id: org.id,
    property_id: propertyId,
    portal,
    label: normalizeText(formData.get("label")),
    url,
    status,
    posted_on: normalizeDate(formData.get("posted_on")),
    notes: normalizeText(formData.get("notes")),
  });

  revalidatePath(`/dashboard/properties/${propertyId}`);
  // `pn` is a fresh nonce so the add-post form REMOUNTS and its uncontrolled
  // inputs clear on a soft-nav redirect (S226 QA-audit form-reset fix). The
  // `post=added` flag is kept separate so the existing success banner logic is
  // untouched.
  redirect(`/dashboard/properties/${propertyId}?post=added&pn=${Date.now().toString(36)}`);
}

export async function updateListingPost(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const id = String(formData.get("post_id") ?? "");
  if (!propertyId || !id) return;

  const portal = normalizePortal(formData.get("portal"));
  const status = normalizeListingStatus(formData.get("status"));
  const url = normalizeUrl(formData.get("url"));
  const check = validateListingPost({ portal, status, url });
  if (!check.ok) {
    redirect(`/dashboard/properties/${propertyId}?posterr=${check.code}`);
  }

  const supabase = createClient();
  // RLS scopes the update to the caller's org; .eq("id") targets one post.
  await supabase
    .from("listing_posts")
    .update({
      portal,
      label: normalizeText(formData.get("label")),
      url,
      status,
      posted_on: normalizeDate(formData.get("posted_on")),
      notes: normalizeText(formData.get("notes")),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?post=saved`);
}

export async function removeListingPost(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const id = String(formData.get("post_id") ?? "");
  if (!propertyId || !id) return;

  const supabase = createClient();
  // RLS scopes the delete to the caller's org. Leads keep their captured source
  // text; their listing_post_id FK is set null by the ON DELETE rule.
  await supabase.from("listing_posts").delete().eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?post=removed`);
}

// ===========================================================================
// Property photos — upload + cover + reorder + delete (Supabase Storage).
// Files ride this server action as multipart FormData (body cap raised in
// next.config). Each file is validated against lib/photos before it touches
// Storage; the bucket + storage RLS (migration 0019) are the backstop. All
// actions are redirect-based to dodge the 503 WATCH on revalidate-only actions.
// Status is surfaced back via ?photos=… / ?photoerr=… on the property page.
// ===========================================================================

type PhotoRow = PhotoLike & { storage_path: string };

export async function uploadPropertyPhotos(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const fail = (reason: string) =>
    redirect(`/dashboard/properties/${propertyId}?photoerr=${reason}`);

  // Browser File objects arrive as FormData entries named "photos".
  const files = formData
    .getAll("photos")
    .filter(
      (f): f is File =>
        typeof f === "object" && f !== null && "size" in f && "type" in f,
    )
    .filter((f) => f.size > 0); // empty file input yields a 0-byte entry

  if (files.length === 0) fail("none");

  const supabase = createClient();

  // Enforce the per-unit cap against what's already stored.
  const { data: existing } = await supabase
    .from("property_photos")
    .select("id, sort_order, is_cover")
    .eq("property_id", propertyId);
  const existingRows = (existing ?? []) as PhotoLike[];

  // The per-rental photo allowance is plan-scoped (Premium gets more). Every
  // current plan resolves to the base cap, so this is behavior-identical today.
  if (existingRows.length + files.length > photoCapForPlan(org.plan)) {
    fail("max");
  }

  // Reject the whole batch on the first bad file so the operator re-picks with
  // a clear message rather than getting a confusing partial upload.
  for (const f of files) {
    const v = validatePhotoUpload({ type: f.type, size: f.size });
    if (!v.ok) fail(v.reason);
  }

  let order = nextSortOrder(existingRows);
  let firstEver = existingRows.length === 0;
  let uploaded = 0;

  for (const file of files) {
    const photoId = crypto.randomUUID();
    const path = photoStoragePath(
      org.id,
      propertyId,
      photoId,
      extForType(file.type),
    );

    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) continue; // best-effort: skip a failed file, keep going

    const {
      data: { publicUrl },
    } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);

    const { error: insErr } = await supabase.from("property_photos").insert({
      id: photoId,
      organization_id: org.id,
      property_id: propertyId,
      storage_path: path,
      url: publicUrl,
      sort_order: order,
      is_cover: firstEver, // the very first photo on a unit becomes the cover
    });
    if (insErr) {
      // Roll back the orphaned object so Storage and the table stay in sync.
      const { error: rbErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .remove([path]);
      if (rbErr) {
        console.error("uploadPhotos: rollback remove failed", {
          path,
          error: rbErr.message,
        });
      }
      continue;
    }

    order += 1;
    firstEver = false;
    uploaded += 1;
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  if (uploaded === 0) redirect(`/dashboard/properties/${propertyId}?photoerr=failed`);
  redirect(`/dashboard/properties/${propertyId}?photos=${uploaded}`);
}

// ---------------------------------------------------------------------------
// Import photos from operator-pasted direct image links (REAL-WORLD-INTAKE
// item Q, Phase 1). The realtor-onboarding path (paste MLS -> prefill -> copy)
// always leaves photos as the one manual step; this lets an operator paste
// direct image links instead of saving + re-selecting files.
//
// SSRF posture: a server fetch of an operator-supplied URL must not be steerable
// at internal/cloud-metadata addresses. The pure lib/image-url-import module
// holds the rules (scheme/host/IP-range checks + magic-byte sniffing); the
// helper below adds the impure parts: it RESOLVES the hostname and rejects if
// ANY resolved address is private/reserved, follows redirects MANUALLY and
// re-validates every hop, and caps both response size and time. We trust the
// bytes (magic-byte sniff), never the Content-Type header, for the stored type.
// ---------------------------------------------------------------------------

const IMPORT_FETCH_TIMEOUT_MS = 10_000;
const IMPORT_MAX_REDIRECTS = 3;

/** Resolve a hostname and confirm EVERY address it maps to is public. */
async function hostResolvesToPublicOnly(host: string): Promise<boolean> {
  try {
    const dns = await import("node:dns/promises");
    const addrs = await dns.lookup(host, { all: true });
    if (addrs.length === 0) return false;
    return addrs.every((a) => !isBlockedAddress(a.address));
  } catch {
    return false;
  }
}

type FetchedImage = { bytes: Uint8Array; type: string };

/**
 * Fetch one image URL safely, or return null on any failure (best-effort per
 * link). Validates scheme/host, resolves + re-checks the IP, follows redirects
 * manually re-validating each hop, caps size + time, and confirms the bytes are
 * a supported image via magic-byte sniff.
 */
async function fetchImageFromUrl(rawUrl: string): Promise<FetchedImage | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= IMPORT_MAX_REDIRECTS; hop++) {
    const v = validateImageUrl(current);
    if (!v.ok) return null;
    if (!(await hostResolvesToPublicOnly(v.host))) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(v.url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "VacantlessImporter/1.0", Accept: "image/*" },
      });
    } catch {
      clearTimeout(timer);
      return null;
    }

    // Manual redirect: re-validate the next hop's URL rather than letting fetch
    // follow it (a redirect could otherwise point back at an internal address).
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        current = new URL(loc, v.url).href;
      } catch {
        return null;
      }
      continue;
    }

    if (!res.ok || !res.body) {
      clearTimeout(timer);
      return null;
    }
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) {
      clearTimeout(timer);
      return null;
    }

    // Stream with a hard size cap so a server that omits/lies about
    // Content-Length still can't make us buffer an unbounded body.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > MAX_PHOTO_BYTES) {
            await reader.cancel();
            clearTimeout(timer);
            return null;
          }
          chunks.push(value);
        }
      }
    } catch {
      clearTimeout(timer);
      return null;
    }
    clearTimeout(timer);

    if (total <= 0) return null;
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    const type = sniffImageType(bytes);
    if (!type) return null;
    return { bytes, type };
  }
  return null; // too many redirects
}

export async function importPropertyPhotosFromUrls(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const fail = (reason: string) =>
    redirect(`/dashboard/properties/${propertyId}?photoerr=${reason}`);

  const urls = parseImageUrls(String(formData.get("photo_urls") ?? ""));
  if (urls.length === 0) fail("urlnone");

  const supabase = createClient();

  const { data: existing } = await supabase
    .from("property_photos")
    .select("id, sort_order, is_cover")
    .eq("property_id", propertyId);
  const existingRows = (existing ?? []) as PhotoLike[];

  // Same plan-scoped cap the file uploader enforces.
  const remaining = photoCapForPlan(org.plan) - existingRows.length;
  if (remaining <= 0) fail("urlmax");

  let order = nextSortOrder(existingRows);
  let firstEver = existingRows.length === 0;
  let added = 0;
  let skipped = 0;

  for (const raw of urls) {
    if (added >= remaining) {
      skipped += 1; // over the cap — count the rest as skipped
      continue;
    }
    const img = await fetchImageFromUrl(raw);
    if (!img) {
      skipped += 1;
      continue;
    }

    const photoId = crypto.randomUUID();
    const path = photoStoragePath(org.id, propertyId, photoId, extForType(img.type));

    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, img.bytes, {
        contentType: img.type,
        upsert: false,
      });
    if (upErr) {
      skipped += 1;
      continue;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);

    const { error: insErr } = await supabase.from("property_photos").insert({
      id: photoId,
      organization_id: org.id,
      property_id: propertyId,
      storage_path: path,
      url: publicUrl,
      sort_order: order,
      is_cover: firstEver,
    });
    if (insErr) {
      // Roll back the orphaned object so Storage and the table stay in sync.
      const { error: rbErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .remove([path]);
      if (rbErr) {
        console.error("importPhotosFromUrls: rollback remove failed", {
          path,
          error: rbErr.message,
        });
      }
      skipped += 1;
      continue;
    }

    order += 1;
    firstEver = false;
    added += 1;
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  if (added === 0) fail("urlfailed");
  const skip = skipped > 0 ? `&photoskipped=${skipped}` : "";
  redirect(`/dashboard/properties/${propertyId}?photos=${added}${skip}`);
}

// ---------------------------------------------------------------------------
// Import photos from a Dropbox shared-folder link (REAL-WORLD-INTAKE item Q,
// Phase 2). Photo/tour vendors deliver in many shapes, but operators file every
// delivery into Dropbox — so a shared gallery/ folder link is the vendor-
// agnostic source. We enumerate it via the Dropbox API and download each image
// server-side, reusing the Phase-1 validate (magic-byte sniff) + store path.
//
// Auth posture: the Dropbox token is OUR service account's — it only READS the
// public shared link the operator pasted (no per-landlord OAuth). The pure
// lib/dropbox-import module holds the rules (URL validation, image filter, sort,
// nested detection); the helpers below add the impure parts: the token, the
// list_folder enumeration (+ pagination), and the size/time-capped byte fetch.
// ---------------------------------------------------------------------------

const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT_API = "https://content.dropboxapi.com/2";

/** Escape non-ASCII so a file name is safe inside the Dropbox-API-Arg header. */
function dropboxApiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) =>
    "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

/**
 * Resolve a Dropbox access token for OUR service account. Prefers a long-lived
 * OAuth refresh token (DROPBOX_REFRESH_TOKEN + DROPBOX_APP_KEY/SECRET) exchanged
 * server-side for a short-lived access token; falls back to a directly-supplied
 * DROPBOX_ACCESS_TOKEN (the App-Console token used for the first prove-out).
 * Returns null when unconfigured so the action shows a clean "not set up" note.
 */
async function getDropboxAccessToken(): Promise<string | null> {
  const refresh = process.env.DROPBOX_REFRESH_TOKEN;
  const key = process.env.DROPBOX_APP_KEY;
  const secret = process.env.DROPBOX_APP_SECRET;
  if (refresh && key && secret) {
    try {
      const auth = Buffer.from(`${key}:${secret}`).toString("base64");
      const res = await fetch("https://api.dropbox.com/oauth2/token", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { access_token?: string };
      return json.access_token ?? null;
    } catch {
      return null;
    }
  }
  const direct = process.env.DROPBOX_ACCESS_TOKEN;
  return direct && direct.trim() ? direct.trim() : null;
}

type DropboxApiEntry = {
  ".tag"?: string;
  name?: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
};
type DropboxListResponse = {
  entries?: DropboxApiEntry[];
  cursor?: string;
  has_more?: boolean;
};

function collectDropboxEntries(
  json: DropboxListResponse,
  out: DropboxEntry[],
): void {
  for (const e of json.entries ?? []) {
    if (typeof e.name !== "string") continue;
    out.push({
      tag: typeof e[".tag"] === "string" ? (e[".tag"] as string) : "",
      name: e.name,
      path_lower: e.path_lower,
      path_display: e.path_display,
      size: e.size,
    });
  }
}

// Caps so an operator who pastes a huge top-level folder can't make us walk
// forever. A real single-listing archive is well under both, even across years.
const DROPBOX_MAX_ENTRIES = 5000;
const DROPBOX_MAX_FOLDERS = 200; // how many subfolders the tree walk will visit
const DROPBOX_WALK_CONCURRENCY = 8; // sibling folders listed at once

/**
 * Enumerate the entries directly under one level of a Dropbox shared folder
 * (NON-recursive — `path` is "" for the share root or "/a/b" for a subfolder).
 * Dropbox does not allow `recursive: true` together with a `shared_link`, so the
 * deep walk is done by dropboxListSharedTree calling this per folder. Paginates
 * via list_folder/continue and stops at DROPBOX_MAX_ENTRIES. Null on API error.
 */
async function dropboxListSharedFolder(
  token: string,
  shareUrl: string,
  path = "",
): Promise<DropboxEntry[] | null> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const entries: DropboxEntry[] = [];
  try {
    let res = await fetch(`${DROPBOX_API}/files/list_folder`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path, shared_link: { url: shareUrl } }),
    });
    if (!res.ok) return null;
    let json = (await res.json()) as DropboxListResponse;
    collectDropboxEntries(json, entries);
    let guard = 0;
    while (
      json.has_more &&
      json.cursor &&
      guard < 50 &&
      entries.length < DROPBOX_MAX_ENTRIES
    ) {
      guard += 1;
      res = await fetch(`${DROPBOX_API}/files/list_folder/continue`, {
        method: "POST",
        headers,
        body: JSON.stringify({ cursor: json.cursor }),
      });
      if (!res.ok) return null;
      json = (await res.json()) as DropboxListResponse;
      collectDropboxEntries(json, entries);
    }
  } catch {
    return null;
  }
  return entries;
}

/**
 * Walk a whole Dropbox shared folder breadth-first using the per-level lister
 * above (since Dropbox blocks recursive listing on shared links). Returns every
 * entry found across the tree — files (with their full path_display) and the
 * folders we descended — so the caller can group images by their parent folder.
 * Bounded by DROPBOX_MAX_FOLDERS / DROPBOX_MAX_ENTRIES; sibling folders are
 * listed DROPBOX_WALK_CONCURRENCY at a time to keep wall-time low. Null only
 * when the ROOT listing fails (a private/expired link); a single subfolder that
 * errors mid-walk is skipped best-effort.
 */
async function dropboxListSharedTree(
  token: string,
  shareUrl: string,
): Promise<DropboxEntry[] | null> {
  // List one level and stamp every entry with a path we KNOW is relative to the
  // share root, built from the parent's relative path + the entry name. Dropbox's
  // own path_display is unreliable for a shared link we don't own (it can be the
  // owner's absolute account path), so we never trust it for descent/download —
  // we overwrite it with our computed value and use that everywhere downstream.
  const visit = async (relParent: string): Promise<DropboxEntry[] | null> => {
    const entries = await dropboxListSharedFolder(token, shareUrl, relParent);
    if (entries === null) return null;
    for (const e of entries) {
      e.path_display = `${relParent}/${e.name}`; // relParent is "" at the root
    }
    return entries;
  };

  const root = await visit("");
  if (root === null) return null;

  const all: DropboxEntry[] = [...root];
  let frontier = root
    .filter((e) => e.tag === "folder")
    .map((e) => e.path_display as string);
  let visited = 0;

  while (
    frontier.length > 0 &&
    visited < DROPBOX_MAX_FOLDERS &&
    all.length < DROPBOX_MAX_ENTRIES
  ) {
    const batch = frontier.slice(0, DROPBOX_MAX_FOLDERS - visited);
    visited += batch.length;
    const next: string[] = [];
    for (let i = 0; i < batch.length; i += DROPBOX_WALK_CONCURRENCY) {
      const chunk = batch.slice(i, i + DROPBOX_WALK_CONCURRENCY);
      const results = await Promise.all(chunk.map((p) => visit(p)));
      for (const entries of results) {
        if (!entries) continue; // best-effort: skip a folder that errors
        for (const e of entries) {
          all.push(e);
          if (e.tag === "folder") next.push(e.path_display as string);
        }
      }
    }
    frontier = next;
  }
  return all;
}

/**
 * Download one file from under the shared link by its path relative to the share
 * root ("/<name>" for a root file, "/<unit>/<name>" for a unit subfolder).
 * Streams with the same size + timeout caps as the URL importer, then confirms
 * the bytes are a supported image via the magic-byte sniff. Returns null on any
 * failure (best-effort per file).
 */
async function fetchDropboxSharedFile(
  token: string,
  shareUrl: string,
  filePath: string,
): Promise<FetchedImage | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${DROPBOX_CONTENT_API}/sharing/get_shared_link_file`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Dropbox-API-Arg": dropboxApiArg({ url: shareUrl, path: filePath }),
        },
        signal: controller.signal,
      },
    );
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      return null;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_PHOTO_BYTES) {
          await reader.cancel();
          clearTimeout(timer);
          return null;
        }
        chunks.push(value);
      }
    }
    clearTimeout(timer);
    if (total <= 0) return null;
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.length;
    }
    const type = sniffImageType(bytes);
    if (!type) return null;
    return { bytes, type };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// The shape inspectDropboxFolder hands back to the client island. Real archives
// nest photos by year/purpose several levels deep, so we recurse the whole share
// and report the folders that actually hold images: "flat" when there's exactly
// one (import straight away), "folders" with a path+count pick list when there
// are several, or "error". Serializable (it crosses the server-action boundary).
export type DropboxInspectResult =
  | { kind: "flat"; count: number; folder: string }
  | { kind: "folders"; folders: DropboxLeafFolder[] }
  | { kind: "error"; reason: string };

/**
 * Read-only probe of a pasted Dropbox shared-folder link (no writes, no
 * redirect). Recursively enumerates the share and groups images by the folder
 * that directly contains them. The client uses the result to import immediately
 * (one gallery) or show the folder picker (several).
 */
export async function inspectDropboxFolder(
  rawUrl: string,
): Promise<DropboxInspectResult> {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");

  const parsed = parseDropboxFolderUrl(rawUrl);
  if (!parsed.ok) return { kind: "error", reason: "dropboxurl" };

  const token = await getDropboxAccessToken();
  if (!token) return { kind: "error", reason: "dropboxauth" };

  const rawEntries = await dropboxListSharedTree(token, parsed.url);
  if (rawEntries === null) return { kind: "error", reason: "dropboxfailed" };

  const groups = groupImagesByParentPath(rawEntries);
  if (groups.size === 0) {
    const hasFolders = rawEntries.some((e) => e.tag === "folder");
    return { kind: "error", reason: hasFolders ? "dropboxnested" : "dropboxempty" };
  }
  if (groups.size === 1) {
    const [folder, list] = [...groups][0];
    return { kind: "flat", count: list.length, folder };
  }
  return { kind: "folders", folders: leafFolderSummaries(groups) };
}

export async function importPropertyPhotosFromDropboxFolder(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const fail = (reason: string): never =>
    redirect(`/dashboard/properties/${propertyId}?photoerr=${reason}`);

  const parsed = parseDropboxFolderUrl(String(formData.get("dropbox_url") ?? ""));
  if (!parsed.ok) return fail("dropboxurl");
  const shareUrl = parsed.url;

  const token = await getDropboxAccessToken();
  if (!token) return fail("dropboxauth");

  // Recurse the share and group images by the folder that holds them, then take
  // the folder the operator chose. The chosen path is re-confirmed against what
  // we actually found (no acting on a stale/typo'd value); when there's only one
  // gallery a choice isn't required.
  const rawEntries = await dropboxListSharedTree(token, shareUrl);
  if (rawEntries === null) return fail("dropboxfailed");

  const groups = groupImagesByParentPath(rawEntries);
  if (groups.size === 0) {
    return fail(rawEntries.some((e) => e.tag === "folder") ? "dropboxnested" : "dropboxempty");
  }

  const keys = [...groups.keys()];
  let chosen: string | null;
  if (formData.has("folder")) {
    chosen = normalizeFolderChoice(String(formData.get("folder") ?? ""), keys);
    if (chosen === null) return fail("dropboxbadfolder");
  } else if (groups.size === 1) {
    chosen = keys[0];
  } else {
    return fail("dropboxnested"); // several galleries — the operator must pick
  }

  const images = sortGalleryEntries(groups.get(chosen) ?? []);
  if (images.length === 0) return fail("dropboxempty");

  const supabase = createClient();

  const { data: existing } = await supabase
    .from("property_photos")
    .select("id, sort_order, is_cover")
    .eq("property_id", propertyId);
  const existingRows = (existing ?? []) as PhotoLike[];

  const remaining = photoCapForPlan(org.plan) - existingRows.length;
  if (remaining <= 0) fail("dropboxmax");

  let order = nextSortOrder(existingRows);
  let firstEver = existingRows.length === 0;
  let added = 0;
  let skipped = 0;

  for (const entry of images) {
    if (added >= remaining) {
      skipped += 1; // over the cap — count the rest as skipped
      continue;
    }
    // A recursive entry carries its own path relative to the share root; prefer
    // it (canonical case, full depth) over rebuilding from the chosen folder.
    const filePath = entry.path_display ?? dropboxFilePath(chosen, entry.name);
    const img = await fetchDropboxSharedFile(token, shareUrl, filePath);
    if (!img) {
      skipped += 1;
      continue;
    }

    const photoId = crypto.randomUUID();
    const path = photoStoragePath(org.id, propertyId, photoId, extForType(img.type));

    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, img.bytes, { contentType: img.type, upsert: false });
    if (upErr) {
      skipped += 1;
      continue;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path);

    const { error: insErr } = await supabase.from("property_photos").insert({
      id: photoId,
      organization_id: org.id,
      property_id: propertyId,
      storage_path: path,
      url: publicUrl,
      sort_order: order,
      is_cover: firstEver,
    });
    if (insErr) {
      // Roll back the orphaned object so Storage and the table stay in sync.
      const { error: rbErr } = await supabase.storage
        .from(PHOTO_BUCKET)
        .remove([path]);
      if (rbErr) {
        console.error("importPhotosFromDropbox: rollback remove failed", {
          path,
          error: rbErr.message,
        });
      }
      skipped += 1;
      continue;
    }

    order += 1;
    firstEver = false;
    added += 1;
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  if (added === 0) fail("dropboxfailed");
  const skip = skipped > 0 ? `&photoskipped=${skipped}` : "";
  redirect(`/dashboard/properties/${propertyId}?photos=${added}${skip}`);
}

export async function setCoverPhoto(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const id = String(formData.get("photo_id") ?? "");
  if (!propertyId || !id) return;

  const supabase = createClient();
  // Clear the existing cover first (the partial unique index allows only one),
  // then set the new one. RLS scopes both writes to the caller's org.
  await supabase
    .from("property_photos")
    .update({ is_cover: false })
    .eq("property_id", propertyId)
    .eq("is_cover", true);
  await supabase
    .from("property_photos")
    .update({ is_cover: true })
    .eq("id", id)
    .eq("property_id", propertyId);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?photos=cover`);
}

export async function movePhoto(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const id = String(formData.get("photo_id") ?? "");
  const dirRaw = String(formData.get("direction") ?? "");
  const direction = dirRaw === "up" || dirRaw === "down" ? dirRaw : null;
  if (!propertyId || !id || !direction) return;

  const supabase = createClient();
  const { data } = await supabase
    .from("property_photos")
    .select("id, sort_order, is_cover")
    .eq("property_id", propertyId);
  const rows = (data ?? []) as PhotoLike[];

  // Pure, tested reorder; persist only the rows whose order actually changed.
  const next = reorder(rows, id, direction);
  const before = new Map(rows.map((r) => [r.id, r.sort_order]));
  for (const { id: pid, sort_order } of next) {
    if (before.get(pid) !== sort_order) {
      await supabase
        .from("property_photos")
        .update({ sort_order })
        .eq("id", pid);
    }
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?photos=order`);
}

export async function deletePhoto(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const id = String(formData.get("photo_id") ?? "");
  if (!propertyId || !id) return;

  const supabase = createClient();
  const { data } = await supabase
    .from("property_photos")
    .select("id, sort_order, is_cover, storage_path")
    .eq("property_id", propertyId);
  const rows = (data ?? []) as PhotoRow[];

  const target = rows.find((r) => r.id === id);
  if (!target) {
    redirect(`/dashboard/properties/${propertyId}?photos=removed`);
  }

  // If we're deleting the cover, decide who gets promoted (lowest order).
  const promoteId = coverAfterDelete(rows, id);

  // Delete the row first (frees the partial-unique cover slot), then promote.
  await supabase.from("property_photos").delete().eq("id", id);
  if (promoteId) {
    await supabase
      .from("property_photos")
      .update({ is_cover: true })
      .eq("id", promoteId);
  }
  // Remove the underlying object. The authenticated SELECT policy (migration
  // 0025) is what lets remove() actually see + delete the row; without it the
  // Storage API returned 200 with an empty deleted-list and silently orphaned
  // the object. Log any error or an empty result instead of swallowing it so a
  // future regression is visible (the reconcile script is the last-resort
  // backstop). Failure here is non-fatal: the row is already gone.
  if (target) {
    const { data: removed, error: rmErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .remove([target.storage_path]);
    if (rmErr) {
      console.error("deletePhoto: storage remove failed", {
        path: target.storage_path,
        error: rmErr.message,
      });
    } else if (!removed || removed.length === 0) {
      console.error("deletePhoto: storage remove deleted 0 objects (orphan)", {
        path: target.storage_path,
      });
    }
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?photos=removed`);
}

// ---------------------------------------------------------------------------
// Detector inventory (S359) — per-unit smoke/CO detector records (unit_detectors,
// 0080). Capture surface for the date-anchored end-of-life reminder. RLS scopes
// reads/writes to the caller's org; we set organization_id from the caller's org
// on insert so the WITH CHECK passes. No tenant PII here — detector facts only.
// ---------------------------------------------------------------------------

const DETECTOR_TYPES = ["smoke", "co", "combo"] as const;

function normalizeDetectorType(raw: unknown): "smoke" | "co" | "combo" {
  const v = String(raw ?? "").trim();
  return (DETECTOR_TYPES as readonly string[]).includes(v)
    ? (v as "smoke" | "co" | "combo")
    : "combo";
}

/** Bound an optional positive integer to [min,max], else null. */
function parseBoundedIntOrNull(raw: string, min: number, max: number): number | null {
  const n = parseIntOrNull(raw);
  if (n == null) return null;
  if (n < min || n > max) return null;
  return n;
}

export async function addDetector(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;
  const org = await getCurrentOrg();
  if (!org) return;

  const installDate = parseDateOrNull(String(formData.get("install_date") ?? ""));
  const installYear = parseBoundedIntOrNull(String(formData.get("install_year") ?? ""), 1980, 2100);
  const quantityRaw = parseBoundedIntOrNull(String(formData.get("quantity") ?? ""), 1, 999);

  const supabase = createClient();
  await supabase.from("unit_detectors").insert({
    organization_id: org.id,
    property_id: propertyId,
    detector_type: normalizeDetectorType(formData.get("detector_type")),
    location: String(formData.get("location") ?? "").trim() || null,
    install_date: installDate,
    install_year: installYear,
    service_life_years: parseBoundedIntOrNull(String(formData.get("service_life_years") ?? ""), 1, 30),
    quantity: quantityRaw ?? 1,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?detector=added#detectors`);
}

export async function updateDetector(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const installDate = parseDateOrNull(String(formData.get("install_date") ?? ""));
  const installYear = parseBoundedIntOrNull(String(formData.get("install_year") ?? ""), 1980, 2100);
  const quantityRaw = parseBoundedIntOrNull(String(formData.get("quantity") ?? ""), 1, 999);

  const supabase = createClient();
  // RLS scopes the update to the caller's org; .eq("id") targets one row. The
  // EOL stamp is NOT cleared here on purpose: the reminder keys on the computed
  // EOL date, so changing the install date (e.g. logging a replacement) changes
  // the EOL and re-arms the next cycle automatically (see detector-eol-sweep.ts).
  await supabase
    .from("unit_detectors")
    .update({
      detector_type: normalizeDetectorType(formData.get("detector_type")),
      location: String(formData.get("location") ?? "").trim() || null,
      install_date: installDate,
      install_year: installYear,
      service_life_years: parseBoundedIntOrNull(String(formData.get("service_life_years") ?? ""), 1, 30),
      quantity: quantityRaw ?? 1,
      notes: String(formData.get("notes") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?detector=updated#detectors`);
}

export async function removeDetector(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const supabase = createClient();
  await supabase.from("unit_detectors").delete().eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?detector=removed#detectors`);
}

// ---------------------------------------------------------------------------
// Major-equipment inventory (S361) — per-unit water-heater/furnace records
// (unit_equipment, 0081). The sibling of the detector actions above; capture
// surface for the date-anchored end-of-life reminder. RLS scopes reads/writes to
// the caller's org; we set organization_id from the caller's org on insert so the
// WITH CHECK passes. No tenant PII here — equipment facts only. Reuses
// parseBoundedIntOrNull / parseDateOrNull from the detector block.
// ---------------------------------------------------------------------------

const EQUIPMENT_TYPES = ["water_heater", "furnace"] as const;

function normalizeEquipmentType(raw: unknown): "water_heater" | "furnace" {
  const v = String(raw ?? "").trim();
  return (EQUIPMENT_TYPES as readonly string[]).includes(v)
    ? (v as "water_heater" | "furnace")
    : "water_heater";
}

export async function addEquipment(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;
  const org = await getCurrentOrg();
  if (!org) return;

  const installDate = parseDateOrNull(String(formData.get("install_date") ?? ""));
  const installYear = parseBoundedIntOrNull(String(formData.get("install_year") ?? ""), 1950, 2100);
  const quantityRaw = parseBoundedIntOrNull(String(formData.get("quantity") ?? ""), 1, 999);

  const supabase = createClient();
  await supabase.from("unit_equipment").insert({
    organization_id: org.id,
    property_id: propertyId,
    equipment_type: normalizeEquipmentType(formData.get("equipment_type")),
    location: String(formData.get("location") ?? "").trim() || null,
    install_date: installDate,
    install_year: installYear,
    service_life_years: parseBoundedIntOrNull(String(formData.get("service_life_years") ?? ""), 1, 40),
    quantity: quantityRaw ?? 1,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?equipment=added#equipment`);
}

export async function updateEquipment(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const installDate = parseDateOrNull(String(formData.get("install_date") ?? ""));
  const installYear = parseBoundedIntOrNull(String(formData.get("install_year") ?? ""), 1950, 2100);
  const quantityRaw = parseBoundedIntOrNull(String(formData.get("quantity") ?? ""), 1, 999);

  const supabase = createClient();
  // RLS scopes the update to the caller's org; .eq("id") targets one row. The
  // EOL stamp is NOT cleared here on purpose: the reminder keys on the computed
  // EOL date, so changing the install date (e.g. logging a replacement) changes
  // the EOL and re-arms the next cycle automatically (see equipment-eol-sweep.ts).
  await supabase
    .from("unit_equipment")
    .update({
      equipment_type: normalizeEquipmentType(formData.get("equipment_type")),
      location: String(formData.get("location") ?? "").trim() || null,
      install_date: installDate,
      install_year: installYear,
      service_life_years: parseBoundedIntOrNull(String(formData.get("service_life_years") ?? ""), 1, 40),
      quantity: quantityRaw ?? 1,
      notes: String(formData.get("notes") ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?equipment=updated#equipment`);
}

export async function removeEquipment(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const supabase = createClient();
  await supabase.from("unit_equipment").delete().eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?equipment=removed#equipment`);
}

// ---------------------------------------------------------------------------
// Appliance inventory (S362) — per-unit appliance records (unit_appliances,
// 0082). The third per-unit asset record after detectors + equipment; capture
// surface for TWO date-anchored reminders: a warranty one-shot and a recurring
// consumable. RLS scopes reads/writes to the caller's org; we set
// organization_id from the caller's org on insert so the WITH CHECK passes. No
// tenant PII here — appliance facts only (make/model/serial are the
// manufacturer's). Reuses parseBoundedIntOrNull / parseDateOrNull from the
// detector block.
// ---------------------------------------------------------------------------

const APPLIANCE_TYPES_ACTION = [
  "fridge",
  "stove",
  "dishwasher",
  "washer",
  "dryer",
  "microwave",
  "other",
] as const;
type ApplianceTypeAction = (typeof APPLIANCE_TYPES_ACTION)[number];

function normalizeApplianceType(raw: unknown): ApplianceTypeAction {
  const v = String(raw ?? "").trim();
  return (APPLIANCE_TYPES_ACTION as readonly string[]).includes(v)
    ? (v as ApplianceTypeAction)
    : "fridge";
}

/** The shared field parse for add + update (everything but org/property/id).
 * S389: consumables moved to their own child table (appliance_consumables), so
 * the appliance row no longer carries the embedded consumable_* fields — those
 * are handled by the consumable actions below. */
function applianceFieldsFromForm(formData: FormData) {
  return {
    appliance_type: normalizeApplianceType(formData.get("appliance_type")),
    make: String(formData.get("make") ?? "").trim() || null,
    model: String(formData.get("model") ?? "").trim() || null,
    serial: String(formData.get("serial") ?? "").trim() || null,
    location: String(formData.get("location") ?? "").trim() || null,
    purchase_date: parseDateOrNull(String(formData.get("purchase_date") ?? "")),
    install_year: parseBoundedIntOrNull(String(formData.get("install_year") ?? ""), 1950, 2100),
    quantity: parseBoundedIntOrNull(String(formData.get("quantity") ?? ""), 1, 999) ?? 1,
    warranty_months: parseBoundedIntOrNull(String(formData.get("warranty_months") ?? ""), 1, 600),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

/** Parse a consumable's fields (label + interval + last-replaced) from a form.
 * Returns null when there is no usable consumable (no label OR no interval), so
 * callers can treat "no consumable entered" cleanly. */
function consumableFieldsFromForm(formData: FormData): {
  label: string;
  interval_months: number;
  anchor_date: string | null;
  notes: string | null;
} | null {
  const label = String(formData.get("consumable_label") ?? "").trim();
  const interval = parseBoundedIntOrNull(
    String(formData.get("consumable_interval_months") ?? ""),
    1,
    120,
  );
  if (!label || interval == null) return null;
  return {
    label,
    interval_months: interval,
    anchor_date: parseDateOrNull(String(formData.get("consumable_anchor_date") ?? "")),
    notes: String(formData.get("consumable_notes") ?? "").trim() || null,
  };
}

export async function addAppliance(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;
  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();

  // Confirm the target property is one the caller's org can actually see (RLS
  // scopes this read) before attaching an appliance to it. The insert's RLS WITH
  // CHECK validates only organization_id — NOT that property_id belongs to the
  // org — so a crafted request pairing the caller's org id with a foreign
  // property_id would otherwise create an orphan appliance row (S369 security
  // review F3; defense-in-depth — the in-app + review-queue pickers only ever
  // offer org-scoped properties, but the action must not trust that).
  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties?notfound=1");

  const { data: created } = await supabase
    .from("unit_appliances")
    .insert({
      organization_id: org.id,
      property_id: propertyId,
      ...applianceFieldsFromForm(formData),
    })
    .select("id")
    .single();

  // S389: the Add form carries an OPTIONAL first consumable (also where a plate/
  // manual scan seeds a recommended one), so the appliance + its first consumable
  // are created in a single save. Additional consumables are added from the
  // per-appliance Consumables block. Best-effort; never blocks the add.
  const firstConsumable = consumableFieldsFromForm(formData);
  if (created?.id && firstConsumable) {
    await supabase.from("appliance_consumables").insert({
      organization_id: org.id,
      property_id: propertyId,
      appliance_id: created.id,
      ...firstConsumable,
    });
  }

  // Phase 2 (S365): if this add came from a scan that stored the image as a
  // pending capture, PROMOTE that document — link it to the just-created
  // appliance and clear pending_until so it becomes a normal receipt (and is no
  // longer reapable). Best-effort; never blocks the add.
  //
  // F2 (S369 / Codex 2026-06-29 audit, KI562). The guard is:
  //   appliance_id IS NULL                                 -- idempotent: don't re-link
  //   AND (pending_until IS NOT NULL OR expense_id IS NOT NULL)
  // The OR is the key. A capture's FIRST promote clears pending_until, so if the
  // landlord logged the EXPENSE first (which set expense_id + cleared pending_until)
  // and THEN adds the appliance, the old "pending_until IS NOT NULL" guard would
  // WRONGLY block the second link. Allowing "the other link is already set" lets
  // the both-promotes ordering complete. And it still refuses to link a plain
  // vault doc (a lease/person file: pending_until NULL, both links NULL -> the OR
  // is false), which closes the under-constrained-promote finding. (source can't
  // distinguish a capture: the in-app scan stores source='uploaded'.)
  const pendingDocId = normalizePendingDocId(formData.get("pending_doc_id"));
  if (created?.id && pendingDocId) {
    await supabase
      .from("documents")
      .update({ appliance_id: created.id, pending_until: null, updated_at: new Date().toISOString() })
      .eq("id", pendingDocId)
      .eq("organization_id", org.id)
      .is("appliance_id", null)
      .or("pending_until.not.is.null,expense_id.not.is.null");
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?appliance=added#appliances`);
}

export async function updateAppliance(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const supabase = createClient();
  // RLS scopes the update to the caller's org; .eq("id") targets one row. The
  // reminder stamps are NOT cleared here on purpose: each reminder keys on its
  // computed target date (warranty expiry / consumable next-due), so changing the
  // purchase date / warranty length / consumable anchor moves the target and
  // re-arms the relevant cycle automatically (see appliance-care-sweep.ts).
  await supabase
    .from("unit_appliances")
    .update({
      ...applianceFieldsFromForm(formData),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?appliance=updated#appliances`);
}

export async function removeAppliance(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const supabase = createClient();
  // Soft-delete (and remove the bytes of) any receipts attached to this appliance
  // BEFORE deleting the appliance. documents.appliance_id is ON DELETE SET NULL,
  // so a bare delete would leave the receipt row with every link nulled — an
  // unreachable orphan whose bytes keep billing in the private bucket. Cleaning
  // them up first hands the rows to the retention purge cron and frees the bytes.
  await softDeleteApplianceReceipts(supabase, id);
  await supabase.from("unit_appliances").delete().eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?appliance=removed#appliances`);
}

// ---------------------------------------------------------------------------
// Appliance consumables (S389) — the recurring-consumable child rows of an
// appliance (appliance_consumables, 0096). An appliance can carry several. RLS
// scopes reads/writes to the caller's org; we set organization_id + property_id
// from the parent appliance (looked up org-scoped) on insert so the WITH CHECK
// passes and the cron can group by unit without a join. No tenant PII.
// ---------------------------------------------------------------------------

/** Resolve the parent appliance, scoped to the caller's org via RLS, returning
 * its id + property_id (needed to denormalize onto the consumable + to redirect).
 * Null when the appliance isn't visible to the caller's org. */
async function resolveOwnedAppliance(
  supabase: ReturnType<typeof createClient>,
  applianceId: string,
): Promise<{ id: string; property_id: string } | null> {
  const { data } = await supabase
    .from("unit_appliances")
    .select("id, property_id")
    .eq("id", applianceId)
    .maybeSingle();
  if (!data || !data.property_id) return null;
  return { id: data.id as string, property_id: data.property_id as string };
}

export async function addConsumable(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const applianceId = String(formData.get("appliance_id") ?? "");
  if (!applianceId) return;
  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();
  const appliance = await resolveOwnedAppliance(supabase, applianceId);
  if (!appliance) redirect("/dashboard/properties?notfound=1");

  const fields = consumableFieldsFromForm(formData);
  if (fields) {
    await supabase.from("appliance_consumables").insert({
      organization_id: org.id,
      property_id: appliance.property_id,
      appliance_id: appliance.id,
      ...fields,
    });
  }

  revalidatePath(`/dashboard/properties/${appliance.property_id}`);
  redirect(`/dashboard/properties/${appliance.property_id}?appliance=consumable_added#appliances`);
}

export async function updateConsumable(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const fields = consumableFieldsFromForm(formData);
  if (!fields) {
    // Nothing usable entered (no label or no interval) — bounce back unchanged.
    redirect(`/dashboard/properties/${propertyId}?appliance=consumable_invalid#appliances`);
  }

  const supabase = createClient();
  // RLS scopes the update to the caller's org; .eq("id") targets one row. The
  // nudge stamp is NOT cleared here on purpose: it keys on the computed next-due
  // date, so changing the interval / last-replaced moves the target and re-arms
  // the cycle automatically (see appliance-care-sweep.ts).
  await supabase
    .from("appliance_consumables")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?appliance=consumable_updated#appliances`);
}

export async function removeConsumable(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const supabase = createClient();
  await supabase.from("appliance_consumables").delete().eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?appliance=consumable_removed#appliances`);
}

// One-tap "Mark replaced" for a recurring consumable (S389: now a child row):
// roll anchor_date to today so the next-due date advances one full interval.
// Clearing nudged_for is belt-and-braces — the next-due date changes anyway, so
// the stamp would no longer match — but nulling it makes the re-arm explicit and
// obvious in the DB.
export async function markConsumableReplaced(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!id || !propertyId) return;

  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)
  const supabase = createClient();
  await supabase
    .from("appliance_consumables")
    .update({
      anchor_date: today,
      nudged_for: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(`/dashboard/properties/${propertyId}?appliance=replaced#appliances`);
}

// ---------------------------------------------------------------------------
// Appliance receipts (S363) — attach a purchase receipt / proof to an appliance,
// reusing the document vault (0076) via documents.appliance_id (0083). A receipt
// is just a `documents` row in the PRIVATE bucket: org-scoped RLS, short-lived
// signed URLs, soft-delete + the retention purge cron, all inherited for free.
// The unit page mints the signed view URL; these actions handle upload + delete.
// Guarded on manage_properties (appliances hang off a property, not a tenancy).
// No tenant PII: a receipt is a store transaction record, not a person's data.
// ---------------------------------------------------------------------------

const applianceAnchor = (propertyId: string, q: string) =>
  `/dashboard/properties/${propertyId}?appliance=${q}#appliances`;

/**
 * Soft-delete every live receipt attached to an appliance and remove its bytes,
 * mirroring documents-actions.deleteTenancyDocument: stamp deleted_at +
 * retention_until (the purge cron's anchor) on rows where deleted_at is null,
 * then delete the stored objects. Shared by removeApplianceReceipt (one row) and
 * removeAppliance (all of an appliance's rows). Best-effort; never throws.
 */
async function softDeleteApplianceReceipts(
  supabase: ReturnType<typeof createClient>,
  applianceId: string,
) {
  const { data: docs } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("appliance_id", applianceId)
    .is("deleted_at", null);
  const rows = (docs ?? []) as { id: string; storage_path: string }[];
  if (rows.length === 0) return;

  const nowIso = new Date().toISOString();
  await supabase
    .from("documents")
    .update({
      deleted_at: nowIso,
      retention_until: retentionUntil(nowIso),
      updated_at: nowIso,
    })
    .eq("appliance_id", applianceId)
    .is("deleted_at", null);

  await removeDocuments(
    supabase,
    rows.map((r) => r.storage_path),
  );
}

/** Upload one receipt (PDF or scan image) and link it to an appliance. */
export async function uploadApplianceReceipt(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const applianceId = String(formData.get("appliance_id") ?? "");
  if (!propertyId) redirect("/dashboard/properties");
  if (!applianceId) redirect(applianceAnchor(propertyId, "receipt-error"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const fail = (reason: string) => redirect(applianceAnchor(propertyId, reason));

  // Exactly one file from the "receipt" input.
  const file = formData
    .getAll("receipt")
    .find(
      (f): f is File =>
        typeof f === "object" &&
        f !== null &&
        "size" in f &&
        "type" in f &&
        (f as File).size > 0,
    );
  if (!file) fail("receipt-none");
  const theFile = file as File;
  const v = validateDocumentUpload({ type: theFile.type, size: theFile.size });
  if (!v.ok) fail(`receipt-${v.reason}`);

  const supabase = createClient();

  // Confirm the appliance belongs to this org (RLS scopes the read) before we
  // attach a receipt to it.
  const { data: appRow } = await supabase
    .from("unit_appliances")
    .select("id")
    .eq("id", applianceId)
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!appRow) fail("receipt-error");

  const docId = crypto.randomUUID();
  const path = documentStoragePath(org.id, docId, documentExtForType(theFile.type));

  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, theFile, { contentType: theFile.type, upsert: false });
  if (upErr) fail("receipt-failed");

  // Tamper-evidence hash of the stored bytes (best-effort).
  let sha256: string | null = null;
  try {
    sha256 = createHash("sha256")
      .update(Buffer.from(await theFile.arrayBuffer()))
      .digest("hex");
  } catch {
    sha256 = null;
  }

  const { error: insErr } = await supabase.from("documents").insert({
    id: docId,
    organization_id: org.id,
    appliance_id: applianceId,
    title: defaultTitleFromFilename(theFile.name),
    doc_type: "receipt",
    storage_path: path,
    mime_type: theFile.type,
    size_bytes: theFile.size,
    sha256,
    source: "uploaded",
  });
  if (insErr) {
    // Roll back the orphaned object so Storage and the table stay in sync.
    const { error: rbErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([path]);
    if (rbErr) {
      console.error("uploadApplianceReceipt: rollback remove failed", {
        path,
        error: rbErr.message,
      });
    }
    fail("receipt-failed");
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(applianceAnchor(propertyId, "receipt-added"));
}

/** Soft-delete one receipt + remove its bytes (the retention cron hard-deletes). */
export async function removeApplianceReceipt(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const documentId = String(formData.get("document_id") ?? "");
  if (!propertyId) redirect("/dashboard/properties");
  if (!documentId) redirect(applianceAnchor(propertyId, "receipt-error"));

  const supabase = createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, storage_path, deleted_at")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) redirect(applianceAnchor(propertyId, "receipt-error"));
  const d = doc as { storage_path: string; deleted_at: string | null };

  const nowIso = new Date().toISOString();
  await supabase
    .from("documents")
    .update({
      deleted_at: nowIso,
      retention_until: retentionUntil(nowIso),
      updated_at: nowIso,
    })
    .eq("id", documentId)
    .is("deleted_at", null);

  await removeDocuments(supabase, [d.storage_path]);

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(applianceAnchor(propertyId, "receipt-removed"));
}

// ---------------------------------------------------------------------------
// Scan a plate / receipt -> prefill the Add-appliance form (S364, Phase 1 of the
// photo-OCR capture). The landlord snaps an appliance data plate (or a receipt);
// we send the image to the multimodal parser (lib/asset-capture-vision, gated on
// ANTHROPIC_API_KEY so it ships dark) and redirect back with the extracted fields
// in namespaced query params, which the unit page reads to OPEN the add form
// PREFILLED for a one-tap review-and-save. The parse output is the join point
// that also feeds the expense ledger (receipt mode) + the Unit Bible — see
// CAPTURE-PHOTO-OCR-EMAIL-IN-DESIGN-2026-06-28.md.
//
// Phase 2 (S365) ALSO keeps the scanned image as the appliance's receipt/proof
// via a pending-document lifecycle: on a successful parse the image is stored as
// a `documents` row with appliance_id NULL + pending_until = now + grace (a
// "pending capture"), and its id rides the redirect (sc_doc=). addAppliance
// promotes it (links appliance_id, clears pending_until) on confirm; an abandoned
// capture is reaped by app/api/cron/document-retention so no bytes are orphaned.
// The store NEVER blocks the scan — if org/upload/insert fails, the scan still
// redirects with the prefill (Phase-1 behaviour: prefill, no kept image). No
// tenant PII: a nameplate / store receipt is the landlord's own record.
//
// Stores a successful scan as a pending-capture `documents` row (private bucket,
// org RLS) and returns the new doc id, or null if anything went wrong (the scan
// then degrades to prefill-only). Mirrors uploadApplianceReceipt's storage path.
async function storePendingCapture(
  supabase: ReturnType<typeof createClient>,
  org: { id: string },
  file: File,
  draft: AssetDraft,
): Promise<string | null> {
  try {
    const docId = crypto.randomUUID();
    const path = documentStoragePath(org.id, docId, documentExtForType(file.type));
    const { error: upErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return null;

    let sha256: string | null = null;
    try {
      sha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    } catch {
      sha256 = null;
    }

    const nowIso = new Date().toISOString();
    const { error: insErr } = await supabase.from("documents").insert({
      id: docId,
      organization_id: org.id,
      // appliance_id stays NULL until addAppliance promotes it on confirm.
      title: defaultTitleFromFilename(file.name),
      // A receipt scan is a 'receipt'; a plate scan is asset proof ('other').
      doc_type: draft.kind === "receipt" ? "receipt" : "other",
      storage_path: path,
      mime_type: file.type,
      size_bytes: file.size,
      sha256,
      source: "uploaded",
      pending_until: pendingCaptureUntil(nowIso),
    });
    if (insErr) {
      // Roll back the orphaned object so Storage + the table stay in sync.
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
      return null;
    }
    return docId;
  } catch {
    return null;
  }
}

export async function scanAppliancePlate(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) redirect("/dashboard/properties");

  // Redirect back to the Appliances section with the scan outcome (+ extracted
  // fields). redirect() is called directly at each exit so its `never` return
  // drives control-flow narrowing (a wrapper loses that).
  const scanUrl = (params: Record<string, string>) =>
    `/dashboard/properties/${propertyId}?${new URLSearchParams(params).toString()}#appliances`;

  const file = formData
    .getAll("plate")
    .find(
      (f): f is File =>
        typeof f === "object" && f !== null && "size" in f && (f as File).size > 0,
    );
  if (!file) redirect(scanUrl({ scan: "none" }));

  // Image-only + the same 25 MB envelope the vault enforces. The vision image
  // block takes images (not PDF) in Phase 1, so exclude anything non-image.
  const v = validateDocumentUpload({ type: file.type, size: file.size });
  if (!v.ok || !isVisionImageType(file.type)) redirect(scanUrl({ scan: "badtype" }));

  // Read the bytes (the only throw-risk; parseAssetImage itself never throws).
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await file.arrayBuffer());
  } catch (err) {
    console.error("scanAppliancePlate: file read failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    redirect(scanUrl({ scan: "failed" }));
  }

  const result = await parseAssetImage(bytes, file.type);

  // unconfigured (no key / ships dark) | failed | empty -> the page shows a
  // matching note and the landlord falls back to manual entry.
  if (!result.ok) redirect(scanUrl({ scan: result.reason }));

  // Phase 2: keep the scanned image as the pending receipt so it links to the
  // appliance on confirm. Best-effort — a store failure degrades to prefill-only.
  const params: Record<string, string> = { scan: "ok", ...plateFieldsToQuery(result.draft) };
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (org) {
    const docId = await storePendingCapture(supabase, org, file as File, result.draft);
    if (docId) params.sc_doc = docId;
  }

  redirect(scanUrl(params));
}

// ---------------------------------------------------------------------------
// Log a scanned RECEIPT as an EXPENSE (S366) — the slice the S365 receipt->expense
// rail was laid for. When a receipt is scanned on a unit page the scope is already
// known (= this property) and merchant/date/total were parsed, so the page offers
// a one-confirm "Log as a $X expense" card. This action validates the confirmed
// form values, inserts an `expenses` row (source 'scan'), and PROMOTES the stored
// receipt image (sc_doc) to that expense — linking it (documents.expense_id, 0085)
// and clearing pending_until so the scan capture becomes a confirmed receipt and is
// never reaped. Guarded on manage_work_orders (the expenses ledger's own
// capability, NOT manage_properties — writing a cost is a different grant than
// editing a unit). No tenant PII: a store receipt is a transaction record.
// ---------------------------------------------------------------------------
export async function logScanExpense(formData: FormData) {
  const propertyId = String(formData.get("property_id") ?? "");
  const scanExpAnchor = (q: string) =>
    `/dashboard/properties/${propertyId}?scanexp=${q}#appliances`;

  await requireCapability(
    "manage_work_orders",
    propertyId ? scanExpAnchor("forbidden") : "/dashboard/properties?forbidden=1",
  );
  if (!propertyId) redirect("/dashboard/properties");
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const supabase = createClient();

  // The expense is unit-scoped to THIS property; confirm it belongs to the org
  // (RLS scopes the read) before attaching a cost to it.
  const { data: prop } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop) redirect(scanExpAnchor("notfound"));

  // Validate the CONFIRMED form values (the owner reviewed the scan's defaults).
  // source 'scan'; scope fixed to this unit (propertyId, never building).
  const check = validateExpenseInput({
    category: String(formData.get("category") ?? "").trim(),
    amountCents: parseMoneyToCents(String(formData.get("amount") ?? "")),
    incurredOn: String(formData.get("incurred_on") ?? "").trim(),
    propertyId,
    buildingKey: null,
    merchant: String(formData.get("merchant") ?? "").trim() || null,
    source: "scan",
  });
  if (!check.ok) redirect(scanExpAnchor(check.code));

  const { data: expense, error } = await supabase
    .from("expenses")
    .insert({
      organization_id: org.id,
      property_id: check.value.propertyId,
      building_key: null,
      category: check.value.category,
      amount_cents: check.value.amountCents,
      incurred_on: check.value.incurredOn,
      merchant: check.value.merchant,
      note: check.value.note,
      source: "scan",
    })
    .select("id")
    .single();
  if (error || !expense) redirect(scanExpAnchor("save"));

  // Promote the stored receipt image (if the scan kept one) to this expense:
  // link expense_id + clear pending_until so it becomes a confirmed receipt (no
  // longer reapable). Best-effort; never blocks the expense.
  //
  // F2 (S369 / Codex 2026-06-29 audit, KI562) — mirror of addAppliance's guard:
  //   expense_id IS NULL                                   -- idempotent: don't re-link
  //   AND (pending_until IS NOT NULL OR appliance_id IS NOT NULL)
  // The previous guard was only "expense_id IS NULL", which would link this
  // expense to ANY org-scoped unlinked doc — including a plain lease/person file
  // that was never a capture (the under-constrained-promote finding). The added
  // OR clause requires the doc to be EITHER a still-pending capture OR one already
  // confirmed against its appliance (the both-promotes ordering, where the
  // appliance promote already cleared pending_until). A plain vault doc has
  // pending_until NULL + both links NULL -> the OR is false -> it is left alone.
  const pendingDocId = normalizePendingDocId(formData.get("pending_doc_id"));
  if (pendingDocId) {
    await supabase
      .from("documents")
      .update({ expense_id: expense.id, pending_until: null, updated_at: new Date().toISOString() })
      .eq("id", pendingDocId)
      .eq("organization_id", org.id)
      .is("expense_id", null)
      .or("pending_until.not.is.null,appliance_id.not.is.null");
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(scanExpAnchor("logged"));
}
