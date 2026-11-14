import { FACEBOOK_RENEW_CHECK, FACEBOOK_RENEW_HOW } from "@/lib/facebook-renew";
import Link from "next/link";
import { countViewingTimes } from "@/lib/viewing-times-count";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isPubliclyVisible, isPublicBookable } from "@/lib/listing-state";
import {
  EmptyState,
  PageHeader,
  SectionHeading,
  PRIMARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { rentalRowReadiness, type ReadinessSignal } from "@/lib/rental-readiness";
import { getCurrentOrg } from "@/lib/org";
import { canUseListingAiImport, freeCapLine } from "@/lib/billing";
import { envFlagEnabled } from "@/lib/auto-listing-copy";
import { distributionWizardEnabled } from "@/lib/stage-wizard-nav";
import { hardDeletable } from "@/lib/property-archive";
import { loadReservedListingPostIds } from "@/lib/listing-post-reservations";
import {
  addProperty,
  importPropertyFromMls,
  importListingFromImages,
  postToMissingSites,
  markAdsRenewed,
  markAllAdsRenewed,
} from "./actions";
import { CopyIntakeButton } from "./copy-intake-button";
import { MlsPdfImport } from "./mls-pdf-import";
import { ListingImageImport } from "./listing-image-import";
import { ReadinessChips } from "./readiness-chips";
import { DeleteOrArchiveControl } from "./row-actions";
import { RowMoreMenu } from "./row-more-menu";
import { loadRenewItems } from "@/lib/renew-list-load";
import { loadPostingCoverage } from "@/lib/posting-coverage-load";
import { readRobotPostingAccess } from "@/lib/robot-posting-access";
import { coverageLabel, shortAddress } from "@/lib/posting-coverage";
import { sortPhotos } from "@/lib/photos";
import { latestStages } from "@/lib/unit-progress-latest";
import { stageChip, STAGE_TONE_CLASS } from "@/lib/unit-progress";
import {
  siteLights,
  postMissingLabel,
  renewLine,
  listRank,
  sortForList,
  listHeadline,
  todoSummary,
  type RowRenew,
} from "@/lib/rental-list-view";

export const dynamic = "force-dynamic";

type PropertyRow = {
  id: string;
  address: string;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  status: string;
  description: string | null;
  archived_at: string | null;
};

type ListingPostRef = {
  id: string;
  property_id: string | null;
  portal: string | null;
  status: string | null;
  url: string | null;
};

// Facebook lists every Marketplace ad the person posted on one page, each
// with its own Renew. Only the person can press it (no API for Marketplace).
const FACEBOOK_YOUR_LISTINGS = "https://www.facebook.com/marketplace/you/selling";

type RentalLaunchState = {
  label: string;
  detail: string;
  action: string;
  href: string;
  tone: "ready" | "active" | "warn" | "muted";
};

/**
 * S670: the posting contract, stated once and unconditionally. The launch-queue
 * redesign deleted the old "Nothing is posted automatically" tooltip, taking
 * this page to ZERO statements of what Vacantless will and will not do on the
 * operator's behalf. Exact wording is Noam's.
 */
const POSTING_SAFETY_PROMISE =
  "We post on your own accounts and save the link to every ad. A site's fee always waits for you.";

const LAUNCH_STATE_CLASS: Record<RentalLaunchState["tone"], string> = {
  ready: "border-sky-200 bg-sky-50 text-sky-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warn: "border-amber-200 bg-amber-50 text-amber-700",
  muted: "border-gray-200 bg-gray-50 text-gray-500",
};

const PRIMARY_ROW_BUTTON =
  "inline-flex items-center justify-center rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90";
const GHOST_ROW_BUTTON =
  "inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50";
const MENU_ITEM =
  "block rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50";

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function missingBasics(row: PropertyRow): string[] {
  const missing: string[] = [];
  if (!row.address?.trim()) missing.push("address");
  if (!row.rent_cents || row.rent_cents <= 0) missing.push("rent");
  if (row.beds == null) missing.push("beds");
  if (row.baths == null) missing.push("baths");
  if (!row.description?.trim()) missing.push("description");
  return missing;
}

function rentalLaunchState({
  row,
  readiness,
  livePostCount,
  archived,
  wizardEnabled,
}: {
  row: PropertyRow;
  readiness: ReadinessSignal[];
  livePostCount: number;
  archived: boolean;
  wizardEnabled: boolean;
}): RentalLaunchState {
  const controlRoomHref = `/dashboard/properties/${row.id}?tab=distribute#distribute-header`;
  // S691 (first-time walk): a rental that has never been on any site opens
  // the guided wizard (Connect sites -> Add details -> Send live), which
  // explains each site in plain words. Once one ad is live, the control room
  // is the right screen. Wizard dark = control room, never a broken link.
  const distributionHref =
    wizardEnabled && livePostCount === 0
      ? `/dashboard/link-portals?property=${encodeURIComponent(row.id)}`
      : controlRoomHref;
  const missing = missingBasics(row);

  if (archived) {
    return {
      label: "Archived",
      detail: "Restore before marketing",
      action: "Review",
      href: `/dashboard/properties/${row.id}`,
      tone: "muted",
    };
  }

  if (row.status === "leased") {
    return {
      label: "Rented",
      detail: "Closed to inquiries",
      action: "Review",
      href: `/dashboard/properties/${row.id}`,
      tone: "muted",
    };
  }

  // S705: a retired rental's page still loads (S672) and used to fall into
  // the Paused branch below.
  if (row.status === "off_market") {
    return {
      label: "Off market",
      detail: "Link shows your open units",
      action: "Review",
      href: `/dashboard/properties/${row.id}`,
      tone: "muted",
    };
  }

  if (isPubliclyVisible(row.status) && !isPublicBookable(row.status)) {
    return {
      label: "Paused",
      detail: "Relist when ready",
      action: "Review",
      href: controlRoomHref,
      tone: "muted",
    };
  }

  if (missing.length > 0) {
    return {
      label: `${pluralize(missing.length, "detail")} missing`,
      detail: `${pluralize(missing.length, "detail")} before you post`,
      action: "Post",
      href: distributionHref,
      tone: "warn",
    };
  }

  const warning = readiness.find((signal) => signal.tone === "warn");
  if (warning?.key === "photos") {
    return {
      label: "Needs photos",
      detail: "Add photos on the way to posting",
      action: "Post",
      href: distributionHref,
      tone: "warn",
    };
  }

  if (warning?.key === "viewings") {
    return {
      label: "Needs viewings",
      detail: "Set viewing windows before you post",
      action: "Set viewings",
      href: "/dashboard/availability",
      tone: "warn",
    };
  }

  if (warning?.key === "feed") {
    return {
      label: "Finish your listing",
      detail: "Fix your listing before you post",
      action: "Post",
      href: distributionHref,
      tone: "warn",
    };
  }

  if (!isPublicBookable(row.status)) {
    return {
      label: "Ready to post",
      detail: "Post it to the rental sites",
      action: "Post",
      href: distributionHref,
      tone: "ready",
    };
  }

  if (livePostCount > 0) {
    return {
      label: `Live on ${pluralize(livePostCount, "site")}`,
      detail: "Ad links saved",
      action: "View results",
      href: controlRoomHref,
      tone: "active",
    };
  }

  return {
    label: "Not on any rental site yet",
    detail: "Post it to the rental sites",
    action: "Post",
    href: distributionHref,
    tone: "ready",
  };
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: {
    added?: string;
    import?: string;
    view?: string;
    deleted?: string;
    archived?: string;
    restored?: string;
    delete_blocked?: string;
    renewed?: string;
    posted?: string;
  };
}) {
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return null;

  const [
    { data: properties },
    { data: rollupRows },
    { data: postRefs },
    { count: availabilityCount },
  ] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, rent_cents, beds, baths, status, description, archived_at")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
    // S748d: counted in the database (property_rollups, migration 0271).
    // Downloading every lead and photo row stopped at the 1,000-row cap and
    // undercounted for large accounts.
    supabase.rpc("property_rollups", { p_org: org.id }),
    supabase
      .from("listing_posts")
      .select("id, property_id, portal, status, url")
      .eq("organization_id", org.id),
    // Org-wide weekly viewing windows — the same signal the property-detail
    // share-readiness check uses. One count for the selected org, so
    // the "Viewings" readiness chip reflects whether ANY rental can be
    // self-booked once a renter lands.
    // S710: weekly windows OR dated hours still to come (lib/viewing-times-count).
    countViewingTimes(supabase, org.id, org.booking_timezone || undefined).then((count) => ({ count })),
  ]);

  // S737: old ads across every rental, for the Renew box (lib/renew-list-load).
  // S754: which sites each available rental is on (lib/posting-coverage-load).
  const [renewItems, coverage] = await Promise.all([
    loadRenewItems(supabase, org.id, org.booking_timezone || "America/Toronto"),
    readRobotPostingAccess(supabase, org.id).then((a) => loadPostingCoverage(supabase, org.id, a.allowed)),
  ]);

  const allRows = (properties ?? []) as PropertyRow[];
  const activeRows = allRows.filter((row) => !row.archived_at);
  const archivedRows = allRows.filter((row) => !!row.archived_at);
  const archivedView = searchParams.view === "archived";
  const rows = archivedView ? archivedRows : activeRows;

  // AI image import (Feature B Slice 2) is DARK: only surface the image-drop
  // path when the env flag is set AND the org's plan carries the entitlement
  // (Growth+). Off => the card isn't rendered and the page behaves exactly as
  // before. The server action re-checks this gate.
  const aiImageImportEnabled =
    !!process.env.LISTING_AI_IMPORT_ENABLED && canUseListingAiImport(org.plan);
  const addPropertyV2Enabled = envFlagEnabled(
    process.env.ADD_PROPERTY_V2_ENABLED,
  );
  const wizardEnabled = distributionWizardEnabled();

  // Per-property inquiry, photo and tenancy counts for the selected org
  // (S748d: one grouped count from the database).
  const leadCounts = new Map<string, number>();
  const tenancyCounts = new Map<string, number>();
  const photoCounts = new Map<string, number>();
  for (const r of (rollupRows ?? []) as {
    property_id: string;
    leads: number | string | null;
    photos: number | string | null;
    tenancies: number | string | null;
  }[]) {
    const n = (v: number | string | null) => Number(v ?? 0) || 0;
    if (n(r.leads)) leadCounts.set(r.property_id, n(r.leads));
    if (n(r.photos)) photoCounts.set(r.property_id, n(r.photos));
    if (n(r.tenancies)) tenancyCounts.set(r.property_id, n(r.tenancies));
  }

  // S681: postCounts gates the Delete control via hardDeletable, so it must
  // exclude co-pilot RESERVATIONS - url-less drafts referenced by a run item.
  // Those are hidden from the where-posted tracker, so an operator can never
  // clear one, and counting them made such a property undeletable forever.
  // Same rule as properties/actions.ts and the detail page, from one module.
  // livePostCounts is untouched: it drives the launch state, not deletion.
  const postRefRows = (postRefs ?? []) as ListingPostRef[];
  const reservedPostIds = await loadReservedListingPostIds(
    postRefRows,
    async (draftIds) => {
      const { data: refRows } = await supabase
        .from("distribution_run_items")
        .select("listing_post_id")
        .in("listing_post_id", draftIds);
      return ((refRows ?? []) as { listing_post_id: string | null }[]).map(
        (ref) => ref.listing_post_id,
      );
    },
  );

  const postCounts = new Map<string, number>();
  const livePostCounts = new Map<string, number>();
  for (const r of postRefRows) {
    if (r.property_id) {
      if (!reservedPostIds.has(r.id)) {
        postCounts.set(r.property_id, (postCounts.get(r.property_id) ?? 0) + 1);
      }
      if (r.status === "live" && r.url?.trim()) {
        livePostCounts.set(
          r.property_id,
          (livePostCounts.get(r.property_id) ?? 0) + 1,
        );
      }
    }
  }

  // S772: one row per rental. Each row carries its site lights (from the
  // coverage rule), its old ads (from the renew rule) and its cover photo, so
  // the page no longer repeats rentals in two panels above the list.
  const adUrls = new Map<string, Map<string, string>>();
  for (const r of postRefRows) {
    const url = r.url?.trim();
    if (!r.property_id || !r.portal || r.status !== "live" || !url) continue;
    const byPortal = adUrls.get(r.property_id) ?? new Map<string, string>();
    if (!byPortal.has(r.portal)) byPortal.set(r.portal, url);
    adUrls.set(r.property_id, byPortal);
  }
  const coverageByProperty = new Map(coverage.rows.map((r) => [r.propertyId, r]));
  const renewByProperty = new Map<string, RowRenew[]>();
  for (const item of renewItems) {
    const list = renewByProperty.get(item.propertyId) ?? [];
    list.push({ portal: item.portal, label: item.label, days: item.days });
    renewByProperty.set(item.propertyId, list);
  }

  const coverByProperty = new Map<string, string>();
  const rowIds = rows.map((r) => r.id);
  // S790a: each rental's latest unit progress stage, for the stage chip.
  const stageByProperty = archivedView ? new Map() : await latestStages(supabase, org.id, rowIds);
  const chipNow = new Date();
  if (rowIds.length > 0) {
    const { data: photoRows } = await supabase
      .from("property_photos")
      .select("id, property_id, url, sort_order, is_cover")
      .in("property_id", rowIds)
      .limit(2000);
    const grouped = new Map<string, { id: string; url: string; sort_order: number; is_cover: boolean }[]>();
    for (const r of (photoRows ?? []) as {
      id: string;
      property_id: string;
      url: string;
      sort_order: number;
      is_cover: boolean;
    }[]) {
      const list = grouped.get(r.property_id) ?? [];
      list.push(r);
      grouped.set(r.property_id, list);
    }
    for (const [id, list] of Array.from(grouped.entries())) {
      const first = sortPhotos(list).find((ph) => !!ph.url);
      if (first) coverByProperty.set(id, first.url);
    }
  }

  const viewRows = sortForList(
    rows.map((p) => {
      const leadCount = leadCounts.get(p.id) ?? 0;
      const tenancyCount = tenancyCounts.get(p.id) ?? 0;
      const postCount = postCounts.get(p.id) ?? 0;
      const livePostCount = livePostCounts.get(p.id) ?? 0;
      const photoCount = photoCounts.get(p.id) ?? 0;
      const readiness = rentalRowReadiness({
        status: p.status,
        rentCents: p.rent_cents,
        beds: p.beds,
        baths: p.baths,
        address: p.address,
        description: p.description,
        photoCount,
        availabilityWindowCount: availabilityCount ?? 0,
      });
      const launch = rentalLaunchState({
        row: p,
        readiness,
        livePostCount,
        archived: archivedView,
        wizardEnabled,
      });
      const bookable = !archivedView && isPublicBookable(p.status);
      const cov = coverageByProperty.get(p.id);
      const renew = archivedView ? [] : renewByProperty.get(p.id) ?? [];
      const lights = !archivedView && cov ? siteLights(cov, adUrls.get(p.id) ?? new Map()) : [];
      const missingRobot = bookable ? cov?.missingRobot ?? [] : [];
      const statusLabel = archivedView
        ? "Archived"
        : p.status === "leased"
          ? "Rented"
          : bookable
            ? "Live"
            : launch.label;
      const statusTone: RentalLaunchState["tone"] = archivedView
        ? "muted"
        : bookable
          ? "active"
          : launch.tone;
      return {
        p,
        leadCount,
        launch,
        readiness,
        bookable,
        renew,
        lights,
        missingRobot,
        madeRoomFor: !archivedView ? cov?.madeRoomFor ?? null : null,
        statusLabel,
        statusTone,
        cover: coverByProperty.get(p.id) ?? null,
        stage: stageChip(stageByProperty.get(p.id), chipNow),
        canHardDelete: hardDeletable(p.status, leadCount, tenancyCount, postCount),
        needsYou:
          (cov?.missing.length ?? 0) > 0 || renew.length > 0 || launch.tone === "warn",
      };
    }),
    (v) => listRank(v.p.status, v.bookable),
  );
  const headline = listHeadline(
    viewRows.map((v) => ({
      status: v.p.status,
      bookable: v.bookable,
      inquiries: v.leadCount,
      needsYou: v.needsYou,
    })),
  );
  // S775: Marketplace ads are counted apart; Facebook decides when Renew opens.
  const marketplaceOld = renewItems.filter((i) => i.portal === "facebook").length;
  const todo = archivedView ? "" : todoSummary(coverage.gaps, renewItems.length - marketplaceOld, marketplaceOld);
  const postedNotice = searchParams.posted
    ? searchParams.posted === "0"
      ? "Those sites need you first: a sign-in or a paid ad. Open the rental to do that."
      : `Queued ${searchParams.posted} ad${searchParams.posted === "1" ? "" : "s"}. They post as soon as they are ready. The rental's page shows each one.`
    : null;
  const renewedNotice = searchParams.renewed
    ? renewItems.length === 0
      ? "All your ads are fresh. We will remind you when one gets old."
      : "Saved. We will remind you when an ad gets old again."
    : null;

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const intakeUrl = (id: string) =>
    host ? `${proto}://${host}/r/${id}` : `/r/${id}`;
  const noticeDismissHref = archivedView
    ? "/dashboard/properties?view=archived"
    : "/dashboard/properties";
  const notice =
    searchParams.deleted
      ? {
          tone: "green",
          text: "Listing deleted.",
        }
      : searchParams.archived
        ? {
            tone: "green",
            text: "Listing archived. You can restore it from the Archived view.",
          }
        : searchParams.restored === "paused"
          ? {
              tone: "amber",
              text: `Listing restored as Paused. ${freeCapLine()}`,
            }
          : searchParams.restored
          ? {
              tone: "green",
              text: "Listing restored to Active as Off market.",
            }
          : searchParams.delete_blocked
            ? {
                tone: "amber",
                text:
                  "That listing now has inquiries or history. Use Archive instead.",
              }
            : null;
  const noticeClass =
    notice?.tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-green-200 bg-green-50 text-green-700";

  return (
    <div>
      <PageHeader
        icon={<Icons.building />}
        eyebrow="Portfolio"
        title="Rentals"
        subtitle="Your rentals and their marketing status."
        action={
          addPropertyV2Enabled ? (
            <Link
              href="/dashboard/properties/new"
              className={PRIMARY_ACTION_CLASS}
              style={{ background: "var(--brand-gradient, var(--brand-color))" }}
            >
              Add rental
            </Link>
          ) : undefined
        }
      />

      {/* S772: the portfolio at a glance. */}
      {!archivedView && activeRows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3 shadow-sm">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              {headline.live > 0 && (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
              )}
              Live
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{headline.live}</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Inquiries</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
              {headline.inquiries.toLocaleString()}
            </p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Rented</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{headline.rented}</p>
          </div>
          <div
            className={`rounded-2xl border px-4 py-3 shadow-sm ${
              headline.needYou > 0 ? "border-amber-200 bg-gradient-to-br from-amber-50 to-white" : "border-gray-200 bg-white"
            }`}
          >
            <p
              className={`text-[11px] font-semibold uppercase tracking-wide ${
                headline.needYou > 0 ? "text-amber-700" : "text-gray-500"
              }`}
            >
              Need you
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
              {headline.needYou > 0 ? headline.needYou : "All set"}
            </p>
          </div>
        </div>
      )}

      {/* S772: one slim line replaces the two panels; each rental's gap or old
          ad is on its own row below. The ids keep the action redirects
          (#site-coverage, #renew-ads) landing here. */}
      <div id="site-coverage" />
      <div id="renew-ads" />
      {(postedNotice || renewedNotice) && (
        <p className="mb-3 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          {postedNotice ?? renewedNotice}
        </p>
      )}
      {todo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5">
          <p className="text-sm text-amber-900">
            <span className="font-semibold">{todo}</span>
            <span className="ml-2 text-xs text-amber-800">Each one is marked on its row.</span>
          </p>
          {renewItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {renewItems.some((i) => i.portal === "facebook") && (
                <a
                  href={FACEBOOK_YOUR_LISTINGS}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={PRIMARY_ROW_BUTTON}
                >
                  Open all my Marketplace ads
                </a>
              )}
              {renewItems.length > 1 && (
                <form action={markAllAdsRenewed}>
                  {renewItems.map((i) => (
                    <input key={`${i.propertyId}-${i.portal}`} type="hidden" name="pair" value={`${i.propertyId}|${i.portal}`} />
                  ))}
                  <button type="submit" className={GHOST_ROW_BUTTON}>
                    I renewed them all
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      )}
      {!archivedView && coverage.signInToAdd.length > 0 && activeRows.length > 0 && (
        <p className="mb-4 text-xs text-gray-500">
          Sign in once to add {coverage.signInToAdd.map(coverageLabel).join(" and ")}:{" "}
          <Link href="/dashboard/settings#site-accounts" className="font-medium text-brand hover:underline">
            your rental site accounts
          </Link>
          .
        </p>
      )}

      {searchParams.added && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Rental added as a draft. Open it to add photos and details. Post it
          to share your inquiry link.
        </p>
      )}

      {searchParams.import === "empty" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Couldn&apos;t read your listing from that text. Paste the listing
          from MLS or realtor.ca. Include address, rent, beds, baths and
          remarks. You can also enter it yourself.
        </p>
      )}
      {searchParams.import === "failed" && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Something went wrong creating the rental. Please try again.
        </p>
      )}
      {searchParams.import === "badimage" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Those files weren&apos;t usable images. Upload a JPG, PNG, WebP or GIF
          photo of the listing. Each one can be up to 8 MB.
        </p>
      )}
      {searchParams.import === "aiempty" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Couldn&apos;t read your listing from those images. Try a clearer
          shot, or enter it yourself.
        </p>
      )}
      {searchParams.import === "aifailed" && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          Reading the images didn&apos;t work just now. Please try again in a
          moment, or enter it yourself.
        </p>
      )}
      {searchParams.import === "unavailable" && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Image import is not part of your subscription right now. Enter it
          yourself, or import it from MLS or realtor.ca.
        </p>
      )}
      {notice && (
        <p
          className={`mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm ${noticeClass}`}
        >
          <span>{notice.text}</span>
          <Link
            href={noticeDismissHref}
            className="shrink-0 text-xs font-medium underline"
          >
            Dismiss
          </Link>
        </p>
      )}

      {allRows.length > 0 && (
        <nav
          aria-label="Rental list view"
          className="mb-4 inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-sm"
        >
          <Link
            href="/dashboard/properties"
            className={`rounded-md px-3 py-1.5 font-medium ${
              archivedView
                ? "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                : "bg-gray-900 text-white"
            }`}
          >
            Active
          </Link>
          <Link
            href="/dashboard/properties?view=archived"
            className={`rounded-md px-3 py-1.5 font-medium ${
              archivedView
                ? "bg-gray-900 text-white"
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            }`}
          >
            Archived: {archivedRows.length}
          </Link>
        </nav>
      )}

      {viewRows.length > 0 ? (
        <ul className="mb-4 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm">
          {viewRows.map((v) => {
            const p = v.p;
            // S792: the Marketplace how-to line shows on the first such row only.
            const firstFacebookRenewId = viewRows.find((r) => r.renew.some((x) => x.portal === "facebook"))?.p.id;
            const detailHref = `/dashboard/properties/${p.id}`;
            const kitHref = `/dashboard/properties/${p.id}#distribute-header`;
            const meta = [
              p.beds != null ? `${p.beds} bd` : null,
              p.baths != null ? `${p.baths} ba` : null,
              v.leadCount > 0 ? `${v.leadCount} ${v.leadCount === 1 ? "inquiry" : "inquiries"}` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const primaryIsPostMissing = v.missingRobot.length > 0;
            return (
              <li key={p.id} className="group px-4 py-3.5 first:rounded-t-2xl transition-colors hover:bg-gray-50/70">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <Link
                      href={detailHref}
                      aria-hidden="true"
                      tabIndex={-1}
                      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-emerald-100 via-teal-50 to-sky-100 ring-1 ring-black/5"
                    >
                      {v.cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v.cover}
                          alt=""
                          loading="lazy"
                          className={`h-full w-full object-cover transition duration-300 group-hover:scale-105 ${
                            p.status === "leased" || archivedView ? "opacity-70 grayscale-[35%]" : ""
                          }`}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-teal-700/70">
                          <Icons.building className="h-5 w-5" />
                        </span>
                      )}
                    </Link>
                    <div className="min-w-0">
                      <Link
                        href={detailHref}
                        className="block truncate font-semibold text-gray-900 hover:underline"
                        title={p.address}
                      >
                        {shortAddress(p.address)}
                      </Link>
                      {meta && <p className="mt-0.5 text-xs text-gray-500">{meta}</p>}
                      {v.stage ? (
                        <Link
                          href="/dashboard/crew"
                          title={`${v.stage.title} Open Unit progress.`}
                          className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition hover:opacity-80 ${STAGE_TONE_CLASS[v.stage.tone]}`}
                        >
                          {v.stage.label}
                          {v.stage.detail ? <span className="font-normal opacity-80">· {v.stage.detail}</span> : null}
                        </Link>
                      ) : null}
                      {(v.lights.length > 0 || !archivedView) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {v.lights.map((l) =>
                            l.live ? (
                              l.url ? (
                                <a
                                  key={l.key}
                                  href={l.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`Live on ${l.label}. Open the ad.`}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" />
                                  {l.label}
                                </a>
                              ) : (
                                <span
                                  key={l.key}
                                  title={`Live on ${l.label}`}
                                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                                >
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" />
                                  {l.label}
                                </span>
                              )
                            ) : l.key === "facebook" ? (
                              <Link
                                key={l.key}
                                href={kitHref}
                                title="Not on Marketplace yet. Open the Marketplace kit."
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-400 transition hover:border-gray-400 hover:text-gray-600"
                              >
                                + {l.label}
                              </Link>
                            ) : (
                              <span
                                key={l.key}
                                title={`Not on ${l.label} yet`}
                                className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[11px] font-medium text-gray-400"
                              >
                                {l.label}
                              </span>
                            ),
                          )}
                          {v.madeRoomFor ? (
                            <span
                              title={`Switched off Rentals.ca to make room for ${v.madeRoomFor}`}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-500"
                            >
                              Rentals.ca: made room for {v.madeRoomFor}
                            </span>
                          ) : null}
                          <ReadinessChips
                            signals={v.readiness}
                            skipNeeds={v.launch.label === "Needs viewings" ? ["viewings"] : []}
                            needsOnly
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 md:justify-end">
                    {/* S772: price and status stay together, buttons stay
                        together, so on a phone the row breaks into two clean
                        lines instead of stranding Edit or More alone. */}
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    <span className="mr-1 text-sm font-semibold tabular-nums text-gray-900">
                      {p.rent_cents ? `$${(p.rent_cents / 100).toLocaleString()}/mo` : "-"}
                    </span>
                    <span
                      title={v.bookable ? "Taking inquiries" : v.launch.detail}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${LAUNCH_STATE_CLASS[v.statusTone]}`}
                    >
                      {v.bookable && (
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                        </span>
                      )}
                      {v.statusLabel}
                    </span>
                    </span>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                    {archivedView ? (
                      <DeleteOrArchiveControl propertyId={p.id} hardDelete={v.canHardDelete} archived />
                    ) : (
                      <>
                        {primaryIsPostMissing ? (
                          <form action={postToMissingSites}>
                            <input type="hidden" name="property_id" value={p.id} />
                            <button type="submit" className={PRIMARY_ROW_BUTTON} title={POSTING_SAFETY_PROMISE}>
                              {postMissingLabel(v.missingRobot)}
                            </button>
                          </form>
                        ) : (
                          <Link
                            href={v.launch.href}
                            className={v.launch.tone === "muted" ? GHOST_ROW_BUTTON : PRIMARY_ROW_BUTTON}
                            title={`${v.launch.detail}. ${POSTING_SAFETY_PROMISE}`}
                          >
                            {v.launch.action}
                          </Link>
                        )}
                        <Link href={`/dashboard/properties/${p.id}?tab=setup#rental-details`} className={GHOST_ROW_BUTTON}>
                          Edit
                        </Link>
                        <RowMoreMenu>
                          {primaryIsPostMissing && (
                            <Link href={v.launch.href} className={MENU_ITEM}>
                              {v.launch.action}
                            </Link>
                          )}
                          {v.bookable && <CopyIntakeButton url={intakeUrl(p.id)} className={MENU_ITEM} />}
                          <DeleteOrArchiveControl propertyId={p.id} hardDelete={v.canHardDelete} />
                        </RowMoreMenu>
                      </>
                    )}
                    </span>
                  </div>
                </div>
                {v.renew.length > 0 && (
                  <div className="mt-2.5 space-y-1.5 md:pl-[4.375rem]">
                    {v.renew.map((item) => (
                      <div
                        key={item.portal}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200"
                      >
                        <span className="font-semibold">{renewLine(item)}</span>
                        {(item.portal !== "facebook" || p.id === firstFacebookRenewId) && (
                          <span className="text-amber-700">
                            {item.portal === "facebook" ? FACEBOOK_RENEW_HOW : "Old ads sink lower on the site."}
                          </span>
                        )}
                        <span className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                          {item.portal === "facebook" ? (
                            <a
                              href={FACEBOOK_YOUR_LISTINGS}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={PRIMARY_ROW_BUTTON}
                            >
                              {FACEBOOK_RENEW_CHECK}
                            </a>
                          ) : (
                            <form action={markAdsRenewed}>
                              <input type="hidden" name="property_id" value={p.id} />
                              <input type="hidden" name="portal" value={item.portal} />
                              <input type="hidden" name="then" value="open" />
                              <button type="submit" className={PRIMARY_ROW_BUTTON}>
                                Renew on {coverageLabel(item.portal)}
                              </button>
                            </form>
                          )}
                          <form action={markAdsRenewed}>
                            <input type="hidden" name="property_id" value={p.id} />
                            <input type="hidden" name="portal" value={item.portal} />
                            <input type="hidden" name="back" value="list" />
                            <button type="submit" className={GHOST_ROW_BUTTON}>
                              I already renewed it
                            </button>
                          </form>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
          {/* S670: stated ONCE under the list rather than per row. A `title`
              tooltip never renders on touch, and this surface is aimed at
              iPad and phone, so the contract needs a visible home. */}
          <li className="rounded-b-2xl bg-gray-50/60 px-4 py-2.5 text-xs text-gray-500">
            {POSTING_SAFETY_PROMISE}
          </li>
        </ul>
      ) : archivedView ? (
        <p className="mb-8 rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-8 text-sm text-gray-500">
          No archived listings.
        </p>
      ) : (
        <div className="mb-8">
          <EmptyState
            icon={<Icons.building />}
            title="No rentals yet"
            description="Add your first rental to create your inquiry link. Renters can then write to you. It takes a couple of minutes."
            cta={{
              href: addPropertyV2Enabled ? "/dashboard/properties/new" : "#add-rental",
              label: "Add your first rental",
            }}
          />
        </div>
      )}

      {/* Building standard policy (S275 IA Step 3): org-level defaults every
          unit inherits. S772: a quiet line under the list, not above it. */}
      {allRows.length > 0 && !archivedView && (
        <p className="mb-8 text-xs text-gray-500">
          <Link href="/dashboard/properties/standard-policy" className="font-medium text-brand hover:underline">
            Building standard policy
          </Link>
          : set lease term, air conditioning, smoking and on-site management once. Every unit inherits it.
        </p>
      )}

      {!addPropertyV2Enabled && (
      <>
      {/* Scroll target for the empty-state CTA. Keep the id stable for existing
          links while the product language says property. */}
      <div id="add-rental" className="scroll-mt-4" />
      <details
        open={
          allRows.length === 0 ||
          Boolean(searchParams.added) ||
          typeof searchParams.import === "string"
        }
        className={
          allRows.length > 0
            ? "mb-8 rounded-2xl border border-gray-200 bg-white shadow-sm"
            : "mb-8"
        }
      >
        <summary
          className={
            allRows.length > 0
              ? "flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm [&::-webkit-details-marker]:hidden"
              : "sr-only"
          }
        >
          <span>
            <span className="font-semibold text-gray-900">Add a rental</span>
            <span className="ml-2 text-xs text-gray-500">
              Enter it yourself, or import from MLS or realtor.ca
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-brand">
            Add
          </span>
        </summary>
        <div
          className={allRows.length > 0 ? "border-t border-gray-100 p-5" : ""}
        >
      {allRows.length === 0 ? <SectionHeading>Add a rental</SectionHeading> : null}

      {/* Fresh-org audit #3: lead with the simple, persona-neutral path. A small
          landlord with no MLS sheet enters an address and goes; the realtor
          MLS / realtor.ca import is demoted to the collapsible below, one click
          away, never the only or the first way in. */}
      <p className="mb-1 text-sm font-medium text-gray-800">
        Enter it yourself
      </p>
      <p className="mb-3 text-xs text-gray-500">
        Just an address creates a draft. Add rent, beds, baths and photos now
        or later. Your listing goes public only when you post it.
      </p>

      <form
        // Keyed on the post-submit nonce so a successful add REMOUNTS this form
        // and clears its uncontrolled inputs (soft-nav reuse would otherwise keep
        // the typed values — S226 QA-audit form-reset fix).
        key={`add-rental-${searchParams.added ?? "new"}`}
        action={addProperty}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      >
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="add_address" className="mb-1 block text-xs font-medium text-gray-600">
            Address
          </label>
          <input
            id="add_address"
            name="address"
            required
            placeholder="123 Main St, Unit 4"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-28">
          <label htmlFor="add_rent" className="mb-1 block text-xs font-medium text-gray-600">
            Rent per month
          </label>
          <input
            id="add_rent"
            name="rent"
            type="number"
            step="0.01"
            placeholder="1250"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-20">
          <label htmlFor="add_beds" className="mb-1 block text-xs font-medium text-gray-600">
            Beds
          </label>
          <input
            id="add_beds"
            name="beds"
            type="number"
            step="1"
            placeholder="2"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-20">
          <label htmlFor="add_baths" className="mb-1 block text-xs font-medium text-gray-600">
            Baths
          </label>
          <input
            id="add_baths"
            name="baths"
            type="number"
            step="0.5"
            placeholder="1"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="w-full">
          <label htmlFor="add_photos" className="mb-1 block text-xs font-medium text-gray-600">
            Photos{" "}
            <span className="font-normal text-gray-400">
              Optional. Add them now so it is ready to share when you post.
              You can also add them later.
            </span>
          </label>
          <input
            id="add_photos"
            name="photos"
            type="file"
            accept="image/*"
            multiple
            className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
        </div>
        <button
          type="submit"
          className={PRIMARY_ACTION_CLASS}
          style={{ background: "var(--brand-gradient, var(--brand-color))" }}
        >
          Add rental
        </button>
      </form>

      {/* Realtor import wedge (item M), demoted to a secondary collapsible
          (fresh-org audit #3): a realtor who already has the unit on MLS or
          realtor.ca prefills a Draft here instead of re-keying it, without the
          import box fronting the page for a landlord who has no data sheet.
          Opens automatically right after an import attempt so the banner above
          lines up with the box the operator just used. */}
      <details
        open={typeof searchParams.import === "string"}
        className="mb-4 rounded-2xl border border-gray-200 bg-white shadow-sm"
      >
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-gray-800 [&::-webkit-details-marker]:hidden">
          Already have it on MLS or realtor.ca? Import it to prefill
        </summary>
        <div className="border-t border-gray-100 p-5 pt-4">
          <form
            key={`mls-import-${searchParams.import ?? "new"}`}
            action={importPropertyFromMls}
          >
            <label
              htmlFor="mls_text"
              className="mb-1 block text-sm font-medium text-gray-800"
            >
              Drop the data sheet or paste the listing to prefill
            </label>
            <p className="mb-3 text-xs text-gray-500">
              Drop the realtor data sheet you saved, or paste the listing text.
              Include address, rent, beds, baths, square footage and remarks.
              A whole realtor.ca page works. A full MLS agent data sheet works
              too. We create a draft for you to review. Your listing goes public
              only when you post it. Photos do not come across, so add those
              after. Use your own listing only. We do not pull from MLS.
            </p>
            <MlsPdfImport
              placeholder={
                "Paste your MLS or realtor.ca listing here, e.g.\nAddress: 123 Main St, Unit 4\nList Price: $1,950 a month\nBedrooms: 2\nBathrooms: 1\nRemarks: Bright two-bedroom with in-suite laundry..."
              }
            />
          </form>

          {/* AI image import (Feature B Slice 2) — only for a listing that
              exists as a picture. Rendered only when the flag + entitlement are
              on (DARK by default); the action re-checks the gate. */}
          {aiImageImportEnabled && (
            <form
              key={`img-import-${searchParams.import ?? "new"}`}
              action={importListingFromImages}
              encType="multipart/form-data"
              className="mt-5 border-t border-gray-100 pt-5"
            >
              <p className="mb-1 block text-sm font-medium text-gray-800">
                Only have a picture of the listing? Upload it to prefill
              </p>
              <p className="mb-3 text-xs text-gray-500">
                Use a screenshot of a Facebook or Kijiji post. A photo of a
                flyer works too, or a saved listing image. We read it into a
                draft for you to review. Photos do not come across, so add those after. Use
                your own listing only.
              </p>
              <ListingImageImport />
            </form>
          )}
        </div>
      </details>
        </div>
      </details>
      </>
      )}
    </div>
  );
}
