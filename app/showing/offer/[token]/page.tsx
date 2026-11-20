import { createClient } from "@/lib/supabase/server";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { formatSlotLong } from "@/lib/booking";
import { futureOfferSlots } from "@/lib/viewing-offers";
import { acceptOfferedTime } from "./actions";

export const dynamic = "force-dynamic";

// S823c: the renter's side of "Offer times to a renter". It shows only the
// times the landlord picked for this renter. There is no calendar here and no
// link to one: when no time works, the renter replies and gets new times.

type OfferResult = {
  ok?: boolean;
  reason?: string;
  status?: string;
  property_address?: string | null;
  property_status?: string | null;
  chosen_slot?: string | null;
  proposed_slots?: unknown;
  timezone?: string | null;
  org_name?: string | null;
  brand_color?: string | null;
  brand_color_secondary?: string | null;
  logo_url?: string | null;
  renter_name?: string | null;
};

function firstName(name: string | null | undefined): string {
  return (name?.trim() || "").split(/\s+/)[0] || "there";
}

function Shell({
  offer,
  children,
}: {
  offer: OfferResult | null;
  children: React.ReactNode;
}) {
  const orgName = offer?.org_name || "Your leasing team";
  const brand = accessibleBrand(offer?.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(offer?.brand_color, offer?.brand_color_secondary);
  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ ["--brand-color" as string]: brand, ["--brand-gradient" as string]: brandBg }}
    >
      {offer?.ok && (
        <header className="relative text-white shadow-md" style={{ background: brandBg }}>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
          <div className="mx-auto max-w-2xl px-6 py-5">
            {offer.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={offer.logo_url} alt={orgName} className="h-8" />
            ) : (
              <p className="text-lg font-semibold">{orgName}</p>
            )}
          </div>
        </header>
      )}
      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
        <p className="mt-4 text-center text-xs text-gray-400">
          <a href="https://www.vacantless.com/?ref=powered-by" target="_blank" rel="noopener" className="hover:underline">
            Powered by Vacantless
          </a>
        </p>
      </main>
    </div>
  );
}

const REPLY_LINE =
  "Reply to the message these times came in and say what works for you. New times will be sent.";

export default async function ViewingOfferPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_viewing_offer", { p_token: params.token });
  const offer = (data as OfferResult | null) ?? null;

  if (!offer?.ok) {
    return (
      <Shell offer={null}>
        <h1 className="text-xl font-semibold text-gray-900">These times are no longer on offer</h1>
        <p className="mt-3 text-sm text-gray-600">{REPLY_LINE}</p>
      </Shell>
    );
  }

  const tz = offer.timezone || "America/Toronto";
  const address = offer.property_address?.trim() || "the rental";

  if (offer.status === "accepted") {
    return (
      <Shell offer={offer}>
        <h1 className="text-xl font-semibold text-gray-900">Viewing confirmed</h1>
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          Your viewing at <span className="font-medium">{address}</span> is booked for{" "}
          <span className="font-medium">
            {offer.chosen_slot ? formatSlotLong(offer.chosen_slot, tz) : "the time you picked"}
          </span>
          .
        </p>
        <p className="mt-4 text-sm text-gray-600">
          A confirmation email is on its way if we have your email address. It has a link to cancel if your plans
          change.
        </p>
      </Shell>
    );
  }

  const open = offer.property_status === "available" ? futureOfferSlots(offer.proposed_slots) : [];
  if (open.length === 0) {
    return (
      <Shell offer={offer}>
        <h1 className="text-xl font-semibold text-gray-900">
          {offer.property_status === "available" ? "These times have passed" : "This rental is no longer available"}
        </h1>
        <p className="mt-3 text-sm text-gray-600">
          {offer.property_status === "available"
            ? REPLY_LINE
            : "Thank you for your interest. Viewings for this rental have stopped."}
        </p>
      </Shell>
    );
  }

  return (
    <Shell offer={offer}>
      <h1 className="text-xl font-semibold text-gray-900">Pick your viewing time</h1>
      <p className="mt-2 text-sm text-gray-600">
        Hi {firstName(offer.renter_name)}, {open.length === 1 ? "this time is" : "these times are"} set aside for
        you to see:
      </p>
      <p className="mt-2 text-sm font-medium text-gray-900">{address}</p>

      {searchParams.status === "taken" && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
          That time was just taken. {open.length > 1 ? "Pick another one below, or reply and ask for new times." : REPLY_LINE}
        </p>
      )}
      {(searchParams.status === "error" || searchParams.status === "invalid" || searchParams.status === "past") && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          That time could not be booked. Please try again.
        </p>
      )}

      <div className="mt-6 space-y-3">
        {open.map((slot) => (
          <form key={slot} action={acceptOfferedTime}>
            <input type="hidden" name="token" value={params.token} />
            <input type="hidden" name="slot" value={slot} />
            <button
              type="submit"
              className="flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-left transition hover:border-emerald-300 hover:bg-emerald-100"
            >
              <span className="block text-base font-semibold text-emerald-950">{formatSlotLong(slot, tz)}</span>
              <span className="text-sm font-semibold text-emerald-800">Book this time</span>
            </button>
          </form>
        ))}
      </div>
      <p className="mt-5 text-sm text-gray-600">
        {open.length === 1 ? "Does it not work?" : "None of them work?"} {REPLY_LINE}
      </p>
    </Shell>
  );
}
