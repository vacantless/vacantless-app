import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import {
  agentDisplayLabel,
  deriveCoordinationStatus,
  coordinationStatusLabel,
} from "@/lib/showing-agents";
import { confirmShowingFromToken } from "./actions";

export const dynamic = "force-dynamic";

// Public agent SHARED CALENDAR + self-confirm (showing routing Slice 3). This is
// the HANDOFF artifact: a covering agent opens ONE link (their stable per-agent
// token, migration 0117) and sees every upcoming viewing routed to them — with
// the address, listing details, the renter's name + tap-to-call/text, the
// property's showing/access instructions, and a one-tap Confirm. No login: the
// token is the handle. Read by the service-role admin client, scoped strictly to
// the agent whose agent_token matches; a wrong token reveals nothing. The page
// only RENDERS (GET); Confirm POSTs the server action, so link scanners that
// prefetch the GET URL can never confirm (KI585).

type Row = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
  confirmed_at: string | null;
  assigned_agent_id: string | null;
  lead: { name: string | null; phone: string | null } | null;
  property: {
    address: string | null;
    beds: number | null;
    baths: number | null;
    rent_cents: number | null;
    parking: string | null;
    showing_instructions: string | null;
  } | null;
};

function fmtWhen(iso: string | null, tz: string): string {
  if (!iso) return "Time to be confirmed";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function fmtRent(cents: number | null): string | null {
  if (cents == null) return null;
  return `$${Math.round(cents / 100).toLocaleString("en-US")}/mo`;
}

// A compact "2 bed · 1 bath · $1,250/mo · Parking" line from the listing fields.
function listingLine(p: Row["property"]): string {
  if (!p) return "";
  const parts: string[] = [];
  if (p.beds != null) parts.push(`${p.beds} bed`);
  if (p.baths != null) parts.push(`${p.baths} bath`);
  const rent = fmtRent(p.rent_cents);
  if (rent) parts.push(rent);
  if (p.parking && p.parking.trim()) parts.push(`Parking: ${p.parking.trim()}`);
  return parts.join(" · ");
}

const tel = (v: string) => `tel:${v.replace(/[^\d+]/g, "")}`;
const sms = (v: string) => `sms:${v.replace(/[^\d+]/g, "")}`;

export default async function AgentCalendarPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { status?: string };
}) {
  const admin = createAdminClient();
  if (!admin) notFound();

  const { data: agentData } = await admin
    .from("showing_agents")
    .select(
      "id, name, tier, archived, organization_id, " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url, booking_timezone)",
    )
    .eq("agent_token", params.token)
    .maybeSingle();
  if (!agentData) notFound();
  const agent = agentData as unknown as {
    id: string;
    name: string;
    tier: string | null;
    archived: boolean;
    organization_id: string;
    organization: {
      name: string | null;
      brand_color: string | null;
      brand_color_secondary: string | null;
      logo_url: string | null;
      booking_timezone: string | null;
    } | null;
  };
  if (agent.archived) notFound();

  const orgName = agent.organization?.name || "Your team";
  const brand = accessibleBrand(agent.organization?.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(
    agent.organization?.brand_color,
    agent.organization?.brand_color_secondary,
  );
  const tz = agent.organization?.booking_timezone || "America/Toronto";

  // Upcoming, still-open viewings routed to this agent. A 2h grace keeps a
  // just-started viewing visible; cancelled / attended / no_show drop off.
  const cutoff = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const { data: showingRows } = await admin
    .from("showings")
    .select(
      "id, scheduled_at, outcome, confirmed_at, assigned_agent_id, " +
        // email intentionally NOT selected: this is an unauthenticated magic-link
        // page, renter PII scope = name + phone (call/text) only.
        "lead:leads(name, phone), " +
        "property:properties(address, beds, baths, rent_cents, parking, showing_instructions)",
    )
    .eq("assigned_agent_id", agent.id)
    .eq("organization_id", agent.organization_id)
    .or("outcome.is.null,outcome.eq.scheduled")
    .gte("scheduled_at", cutoff)
    .order("scheduled_at", { ascending: true });
  const showings = (showingRows ?? []) as unknown as Row[];

  const justConfirmed = searchParams.status === "confirmed";
  const errored = searchParams.status === "error";

  return (
    <div
      className="min-h-screen bg-gray-50"
      style={{ ["--brand-color" as string]: brand, ["--brand-gradient" as string]: brandBg }}
    >
      <header className="relative text-white shadow-md" style={{ background: brandBg }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
        <div className="mx-auto max-w-2xl px-6 py-5">
          {agent.organization?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agent.organization.logo_url} alt={orgName} className="h-8" />
          ) : (
            <p className="text-lg font-semibold">{orgName}</p>
          )}
          <p className="mt-1 text-sm text-white/85">
            Viewings for {agentDisplayLabel({ name: agent.name, tier: agent.tier })}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        {justConfirmed && (
          <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
            Confirmed. The lead agent can now see this viewing is covered.
          </p>
        )}
        {errored && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
            Something went wrong. Please try again.
          </p>
        )}

        {showings.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-gray-900">No upcoming viewings</h1>
            <p className="mt-2 text-sm text-gray-600">
              You have no viewings assigned right now. This page updates automatically as new ones
              are routed to you — keep the link.
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-gray-900">
              {showings.length} upcoming viewing{showings.length === 1 ? "" : "s"}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Tap Confirm once you&apos;ve reached the renter and the viewing is on.
            </p>

            <div className="mt-5 space-y-4">
              {showings.map((s) => {
                const status = deriveCoordinationStatus({
                  outcome: s.outcome,
                  assignedAgentId: s.assigned_agent_id,
                  confirmedAt: s.confirmed_at,
                });
                const confirmed = status === "confirmed";
                const renter = s.lead?.name?.trim() || "A renter";
                const address = s.property?.address?.trim() || "Property";
                const listing = listingLine(s.property);
                const instructions = s.property?.showing_instructions?.trim();
                const phone = s.lead?.phone?.trim();

                return (
                  <div
                    key={s.id}
                    className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                          {fmtWhen(s.scheduled_at, tz)}
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-gray-900">{address}</h2>
                        {listing && <p className="mt-0.5 text-sm text-gray-600">{listing}</p>}
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          confirmed
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {coordinationStatusLabel(status)}
                      </span>
                    </div>

                    <div className="mt-4 rounded-xl bg-gray-50 p-3.5">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                        Renter
                      </p>
                      <p className="mt-1 text-sm font-medium text-gray-900">{renter}</p>
                      {phone && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <a
                            href={tel(phone)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Call {phone}
                          </a>
                          <a
                            href={sms(phone)}
                            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Text
                          </a>
                        </div>
                      )}
                    </div>

                    {instructions && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                          Showing &amp; access instructions
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-amber-900">
                          {instructions}
                        </p>
                      </div>
                    )}

                    <div className="mt-4">
                      {confirmed ? (
                        <p className="text-sm font-medium text-emerald-700">
                          ✓ Confirmed with the renter
                        </p>
                      ) : (
                        <form action={confirmShowingFromToken}>
                          <input type="hidden" name="token" value={params.token} />
                          <input type="hidden" name="showing_id" value={s.id} />
                          <button
                            type="submit"
                            className="w-full rounded-xl px-4 py-3 text-center text-base font-semibold text-white shadow-sm hover:opacity-95"
                            style={{ background: brandBg }}
                          >
                            Confirm this viewing
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
