import { redirect } from "next/navigation";
import { SITES_SETUP_HREF } from "@/lib/sites-setup";
import { cleanPropertyId } from "@/lib/site-signin";

export const dynamic = "force-dynamic";

// S806 (REVIEW-S805 finding 6): "Sign in to your rental sites" and "Connect
// your rental sites" did the same job and disagreed about the same account
// (Rentals.ca "On" on one, "Needs you" on the other). One page now:
// /dashboard/sites. Old links, emails and bookmarks land there with the
// rental they carried; ?address=ready (the renter-email step) keeps its place.
export default function LinkPortalsPage({
  searchParams,
}: {
  searchParams: { property?: string; address?: string };
}) {
  const params = new URLSearchParams();
  const property = cleanPropertyId(searchParams.property);
  if (property) params.set("property", property);
  if (searchParams.address === "ready") params.set("address", "ready");
  const qs = params.toString();
  redirect(`${SITES_SETUP_HREF}${qs ? `?${qs}` : ""}`);
}
