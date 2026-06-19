"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { PROPERTY_STATUSES } from "@/lib/pipeline";
import { pendingDropFrom, leadEligibleForPriceDrop } from "@/lib/price-drop";
import { sendPriceDropAlert } from "@/lib/email";
import { normalizeLaundry, normalizeDogSize } from "@/lib/property-features";
import { parseMlsListing } from "@/lib/mls-import";
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
  type PhotoLike,
  type SourcePhoto,
} from "@/lib/photos";
import { photoCapForPlan } from "@/lib/billing";

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
  await supabase.from("properties").insert({
    organization_id: org.id,
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

  // Structured pet policy (0045). pet_friendly is the DERIVED master (= cats OR
  // dogs) the public RPCs + S240 screening read — keep it in lockstep here so it
  // can never contradict the structured fields. Dog size only applies to dogs.
  const petsCats = parseCheckbox(formData, "pets_cats");
  const petsDogs = parseCheckbox(formData, "pets_dogs");
  const petsDogSize = petsDogs ? normalizeDogSize(formData.get("pets_dog_size")) : null;
  const petsNotes = String(formData.get("pets_notes") ?? "").trim() || null;

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
      sqft: parseIntOrNull(String(formData.get("sqft") ?? "")),
      floor: String(formData.get("floor") ?? "").trim() || null,
      laundry: normalizeLaundry(formData.get("laundry")),
      air_conditioning: parseCheckbox(formData, "air_conditioning"),
      balcony: parseCheckbox(formData, "balcony"),
      furnished: parseCheckbox(formData, "furnished"),
      pet_friendly: petsCats || petsDogs,
      pets_cats: petsCats,
      pets_dogs: petsDogs,
      pets_dog_size: petsDogSize,
      pets_notes: petsNotes,
      heat_included: parseCheckbox(formData, "heat_included"),
      hydro_included: parseCheckbox(formData, "hydro_included"),
      water_included: parseCheckbox(formData, "water_included"),
      photos_ready: parseCheckbox(formData, "photos_ready"),
    })
    .eq("id", id);

  revalidatePath(`/dashboard/properties/${id}`);
  revalidatePath("/dashboard/properties");
  redirect(`/dashboard/properties/${id}?saved=1`);
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
      "address, rent_cents, beds, baths, parking, description, available_date, sqft, floor, laundry, air_conditioning, balcony, furnished, pet_friendly, pets_cats, pets_dogs, pets_dog_size, pets_notes, heat_included, hydro_included, water_included, photos_ready",
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
    sqft: number | null;
    floor: string | null;
    laundry: string | null;
    air_conditioning: boolean;
    balcony: boolean;
    furnished: boolean;
    pet_friendly: boolean;
    pets_cats: boolean;
    pets_dogs: boolean;
    pets_dog_size: string | null;
    pets_notes: string | null;
    heat_included: boolean;
    hydro_included: boolean;
    water_included: boolean;
    photos_ready: boolean;
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
