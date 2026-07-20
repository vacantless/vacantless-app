import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import {
  buildBrowseIndex,
  detailHref,
  type BrowseCard,
  type BrowseIndex,
  type BrowseProvider,
} from "@/lib/browse-surface";

export const revalidate = 900;

const PAGE_TITLE = "Rentals on Vacantless";
const PAGE_DESCRIPTION =
  "Browse active rentals from landlords using Vacantless, then inquire through the listing page.";

const EMPTY_INDEX: BrowseIndex = { cities: [], totalCount: 0 };

export async function generateMetadata(): Promise<Metadata> {
  const base: Metadata = {
    title: PAGE_TITLE,
    description: PAGE_DESCRIPTION,
  };

  if (process.env.BROWSE_SURFACE_ENABLED !== "true") {
    return { ...base, robots: { index: false } };
  }

  const { index } = await loadBrowseIndex();
  if (index.totalCount === 0) return { ...base, robots: { index: false } };
  return base;
}

export default async function RentalsPage() {
  if (process.env.BROWSE_SURFACE_ENABLED !== "true") notFound();

  const { index, unavailable } = await loadBrowseIndex();

  return (
    <div className="min-h-screen bg-[#f6f8f5] text-[#15211d]">
      <main className="mx-auto w-[min(1120px,calc(100%-32px))] py-10 sm:py-14">
        <header className="mb-8 max-w-3xl">
          <p className="text-sm font-bold uppercase tracking-[0.08em] text-[#2f6b58]">
            Vacantless rentals
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            Rentals on Vacantless
          </h1>
          <p className="mt-3 text-base leading-7 text-[#46564e] sm:text-lg">
            Active, landlord-published rentals from the Vacantless network.
            Every inquiry opens the current listing page.
          </p>
        </header>

        {index.totalCount === 0 ? (
          <EmptyState unavailable={unavailable} />
        ) : (
          <div className="space-y-10">
            {index.cities.map((city) => (
              <section key={city.city} aria-labelledby={`${city.citySlug}-heading`}>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2
                      id={`${city.citySlug}-heading`}
                      className="text-2xl font-bold tracking-tight"
                    >
                      {city.city}
                    </h2>
                    <p className="mt-1 text-sm font-medium text-[#607069]">
                      {city.listings.length}{" "}
                      {city.listings.length === 1 ? "rental" : "rentals"}
                    </p>
                  </div>
                  {city.city !== "Ontario" && (
                    <a
                      href={`/rentals/${city.citySlug}`}
                      className="text-sm font-bold text-[#2f6b58] hover:text-[#214b3e]"
                    >
                      View {city.city}
                    </a>
                  )}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {city.listings.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

async function loadBrowseIndex(): Promise<{
  index: BrowseIndex;
  unavailable: boolean;
}> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { index: EMPTY_INDEX, unavailable: true };
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("get_public_browse_listings");
  if (error || !Array.isArray(data)) {
    return { index: EMPTY_INDEX, unavailable: true };
  }

  return {
    index: buildBrowseIndex(data as BrowseProvider[]),
    unavailable: false,
  };
}

function EmptyState({ unavailable }: { unavailable: boolean }) {
  return (
    <section className="rounded-lg border border-[#dce4df] bg-white p-8 shadow-sm">
      <h2 className="text-xl font-bold tracking-tight">
        {unavailable ? "Listings are temporarily unavailable" : "No rentals to show yet"}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5d6b64]">
        {unavailable
          ? "We could not load the current rental inventory. Please check back soon."
          : "There are no browse-ready rentals published on Vacantless right now. Please check back soon."}
      </p>
    </section>
  );
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
          <h3 className="line-clamp-2 text-lg font-bold leading-snug text-[#15211d]">
            {listing.address}
          </h3>
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
