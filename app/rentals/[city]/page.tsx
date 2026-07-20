import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  buildBrowseIndex,
  cityFromSlug,
  detailHref,
  type BrowseCard,
  type BrowseIndex,
  type BrowseProvider,
} from "@/lib/browse-surface";

export const revalidate = 900;

const EMPTY_INDEX: BrowseIndex = { cities: [], totalCount: 0 };

export function generateMetadata({
  params,
}: {
  params: { city: string };
}): Metadata {
  const city = cityFromSlug(params.city);
  if (!city) {
    return {
      title: "Rentals on Vacantless",
      robots: { index: false },
    };
  }

  return {
    title: `Apartments for rent in ${city} | Vacantless`,
    description: `Browse active rentals in ${city} from landlords using Vacantless.`,
  };
}

export default async function RentalsCityPage({
  params,
}: {
  params: { city: string };
}) {
  if (process.env.BROWSE_SURFACE_ENABLED !== "true") notFound();

  const city = cityFromSlug(params.city);
  if (!city) notFound();

  const index = await loadBrowseIndex();
  const group = index.cities.find((entry) => entry.city === city);
  if (!group || group.listings.length === 0) notFound();

  return (
    <div className="min-h-screen bg-[#f6f8f5] text-[#15211d]">
      <main className="mx-auto w-[min(1120px,calc(100%-32px))] py-10 sm:py-14">
        <header className="mb-8 max-w-3xl">
          <a
            href="/rentals"
            className="text-sm font-bold text-[#2f6b58] hover:text-[#214b3e]"
          >
            All rentals
          </a>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Apartments for rent in {city}
          </h1>
          <p className="mt-3 text-base leading-7 text-[#46564e] sm:text-lg">
            Active, landlord-published rentals in {city}. Every inquiry opens
            the current listing page.
          </p>
        </header>

        <div className="mb-4 text-sm font-bold text-[#607069]">
          {group.listings.length}{" "}
          {group.listings.length === 1 ? "rental" : "rentals"}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {group.listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      </main>
    </div>
  );
}

async function loadBrowseIndex(): Promise<BrowseIndex> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return EMPTY_INDEX;

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("get_public_browse_listings");
  if (error || !Array.isArray(data)) return EMPTY_INDEX;

  return buildBrowseIndex(data as BrowseProvider[]);
}

function ListingCard({ listing }: { listing: BrowseCard }) {
  return (
    <a
      href={detailHref(listing.id)}
      className="grid overflow-hidden rounded-lg border border-[#dce4df] bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-[#b8c9c1] hover:shadow-md sm:grid-cols-[168px_minmax(0,1fr)]"
    >
      <div className="aspect-[4/3] bg-[#e7ece9] sm:h-full sm:min-h-[150px]">
        {listing.coverPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.coverPhoto}
            alt={listing.address}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="truncate text-xs font-bold uppercase tracking-[0.07em] text-[#6c7b74]">
            {listing.orgName}
          </p>
          <span className="rounded-full bg-[#eef6f1] px-2.5 py-1 text-xs font-bold text-[#28624f]">
            {listing.availability}
          </span>
        </div>
        <div>
          <h2 className="line-clamp-2 text-lg font-bold leading-snug text-[#15211d]">
            {listing.address}
          </h2>
          <p className="mt-1 text-xl font-extrabold text-[#214b3e]">
            {formatRent(listing.rentCents)}
          </p>
          {listing.specLine && (
            <p className="mt-2 text-sm leading-6 text-[#56655e]">
              {listing.specLine}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

function formatRent(rentCents: number | null): string {
  if (rentCents == null) return "Contact for pricing";
  return `$${Math.round(rentCents / 100).toLocaleString()}/mo`;
}
