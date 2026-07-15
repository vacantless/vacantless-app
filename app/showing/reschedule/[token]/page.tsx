import { createClient } from "@/lib/supabase/server";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { formatSlotLong } from "@/lib/booking";
import { acceptProposedTime } from "./actions";

export const dynamic = "force-dynamic";

type ProposalResult = {
  ok?: boolean;
  reason?: string;
  status?: string;
  token?: string;
  property_id?: string | null;
  property_address?: string | null;
  rent_cents?: number | null;
  scheduled_at?: string | null;
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

function slotList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function InactiveLink({ status }: { status?: string }) {
  if (status === "accepted") {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold text-gray-900">Viewing confirmed</h1>
          <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            Your viewing has been successfully modified and is now confirmed.
          </p>
          <p className="mt-4 text-sm text-gray-600">
            We sent a confirmation email with the updated details.
          </p>
        </div>
      </main>
    );
  }
  const message =
    status === "taken"
      ? "That time is no longer available. Please use the listing page to pick another open time."
      : status === "expired"
        ? "This reschedule link is no longer active."
        : "This reschedule link could not be opened.";
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-gray-900">Link unavailable</h1>
        <p className="mt-3 text-sm text-gray-600">{message}</p>
      </div>
    </main>
  );
}

export default async function RescheduleProposalPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  const { data } = await supabase.rpc("get_reschedule_proposal", {
    p_token: params.token,
  });
  const proposal = (data as ProposalResult | null) ?? null;
  if (!proposal?.ok) {
    return (
      <div className="min-h-screen bg-gray-50">
        <InactiveLink status={searchParams.status ?? proposal?.reason} />
      </div>
    );
  }

  const orgName = proposal.org_name || "Your leasing team";
  const brand = accessibleBrand(proposal.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(
    proposal.brand_color,
    proposal.brand_color_secondary,
  );
  const tz = proposal.timezone || "America/Toronto";
  const address = proposal.property_address?.trim() || "the property";
  const renterFirst = firstName(proposal.renter_name);
  const currentTime = proposal.scheduled_at
    ? formatSlotLong(proposal.scheduled_at, tz)
    : "your current time";
  const acceptedSlot = proposal.chosen_slot || proposal.scheduled_at || null;
  const accepted = searchParams.status === "accepted" || proposal.status === "accepted";
  const proposed = slotList(proposal.proposed_slots);
  const renterUrl = proposal.property_id ? `/r/${proposal.property_id}` : "/";

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ ["--brand-color" as string]: brand, ["--brand-gradient" as string]: brandBg }}
    >
      <header className="relative text-white shadow-md" style={{ background: brandBg }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="mx-auto max-w-2xl px-6 py-5">
          {proposal.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={proposal.logo_url} alt={orgName} className="h-8" />
          ) : (
            <p className="text-lg font-semibold">{orgName}</p>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          {accepted ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Viewing confirmed</h1>
              <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
                Your viewing at <span className="font-medium">{address}</span> has been successfully
                modified and is now confirmed for{" "}
                <span className="font-medium">
                  {acceptedSlot ? formatSlotLong(acceptedSlot, tz) : "the selected time"}
                </span>
                .
              </p>
              <p className="mt-4 text-sm text-gray-600">
                We sent a confirmation email with the updated details.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Time change suggestion</h1>
              <p className="mt-2 text-sm text-gray-600">
                Hi {renterFirst}, would it be possible to adjust your viewing on this property to
                the following?
              </p>
              <p className="mt-2 text-sm font-medium text-gray-900">{address}</p>
              <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
                  Original Showing
                </p>
                <p className="mt-1 font-semibold text-gray-900">{currentTime}</p>
              </div>

              {searchParams.status === "taken" && (
                <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                  That time is no longer available. Please choose another option or see all times.
                </p>
              )}
              {searchParams.status === "error" && (
                <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                  Something went wrong accepting that time. Please try again.
                </p>
              )}

              <div className="mt-6 space-y-3">
                {proposed.map((slot) => (
                  <form key={slot} action={acceptProposedTime}>
                    <input type="hidden" name="token" value={params.token} />
                    <input type="hidden" name="slot" value={slot} />
                    <button
                      type="submit"
                      className="flex w-full items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-left transition hover:border-emerald-300 hover:bg-emerald-100"
                    >
                      <span>
                        <span className="block text-xs font-bold uppercase tracking-wide text-emerald-700">
                          New Suggested Time
                        </span>
                        <span className="mt-1 block text-base font-semibold text-emerald-950">
                          {formatSlotLong(slot, tz)}
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-emerald-800">Accept</span>
                    </button>
                  </form>
                ))}
                <a
                  href={renterUrl}
                  className="block rounded-xl border border-gray-200 px-4 py-3 text-center text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  None of these work — see all available times
                </a>
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
