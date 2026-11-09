"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanCapturedAds, cleanRejectedAds, cleanRenewedAds, type HelperAdEntry } from "@/lib/marketplace-helper";
import {
  helperOrgIds,
  loadHelperAdList,
  saveHelperCapturedAds,
  saveHelperRejectedAds,
  saveHelperRenewedAds,
} from "@/lib/marketplace-helper-server";

// S738: the Vacantless helper's ad list and link capture, called by
// components/marketplace-helper-sync.tsx on any dashboard page, under the
// signed-in person's own session.

async function signedInOrgIds(): Promise<string[] | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const admin = createAdminClient();
  if (!user || !admin) return null;
  return helperOrgIds(admin, user.id);
}

export async function helperAdList(): Promise<HelperAdEntry[]> {
  const orgIds = await signedInOrgIds();
  const admin = createAdminClient();
  if (!orgIds || !admin) return [];
  return loadHelperAdList(admin, orgIds);
}

export async function helperSaveCapturedAds(raw: unknown): Promise<{ done: string[] }> {
  const items = cleanCapturedAds(raw);
  if (items.length === 0) return { done: [] };
  const orgIds = await signedInOrgIds();
  const admin = createAdminClient();
  if (!orgIds || !admin) return { done: [] };
  return { done: await saveHelperCapturedAds(admin, orgIds, items) };
}

// S739: Facebook renewals the helper saw the landlord press.
export async function helperSaveRenewedAds(raw: unknown): Promise<{ done: string[] }> {
  const items = cleanRenewedAds(raw);
  if (items.length === 0) return { done: [] };
  const orgIds = await signedInOrgIds();
  const admin = createAdminClient();
  if (!orgIds || !admin) return { done: [] };
  return { done: await saveHelperRenewedAds(admin, orgIds, items) };
}

// S764: Marketplace ads the helper saw Facebook remove.
export async function helperSaveRejectedAds(
  raw: unknown,
): Promise<{ done: string[]; rentals: { propertyId: string; rental: string }[] }> {
  const items = cleanRejectedAds(raw);
  if (items.length === 0) return { done: [], rentals: [] };
  const orgIds = await signedInOrgIds();
  const admin = createAdminClient();
  if (!orgIds || !admin) return { done: [], rentals: [] };
  return saveHelperRejectedAds(admin, orgIds, items);
}
