import { notFound, redirect } from "next/navigation";
import { AutoSubmit } from "@/components/auto-submit";
import { accessibleBrand, brandGradientCss, DEFAULT_BRAND_COLOR } from "@/lib/brand-theme";
import { showingOutcomeLabel } from "@/lib/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordOutcomeFromToken } from "../actions";

export const dynamic = "force-dynamic";

type Outcome = "attended" | "no_show";

type AgentData = {
  id: string;
  name: string;
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

type ShowingRow = {
  id: string;
  scheduled_at: string | null;
  outcome: string | null;
  lead: { name: string | null } | null;
  property: { address: string | null } | null;
};

function fmtWhen(iso: string | null, tz: string): string {
  if (!iso) return "the scheduled time";
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

function outcomeFromParam(value: string | undefined): Outcome | null {
  return value === "attended" || value === "no_show" ? value : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function targetLabel(outcome: Outcome): string {
  return outcome === "attended" ? "Renter showed" : "No-show";
}

export default async function AgentRecordOutcomePage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { showing?: string; o?: string };
}) {
  const outcome = outcomeFromParam(searchParams.o);
  const landingPath = `/agent/${encodeURIComponent(params.token)}`;
  if (!outcome) redirect(landingPath);

  const admin = createAdminClient();
  if (!admin) notFound();

  const { data: agentData } = await admin
    .from("showing_agents")
    .select(
      "id, name, archived, organization_id, " +
        "organization:organizations(name, brand_color, brand_color_secondary, logo_url, booking_timezone)",
    )
    .eq("agent_token", params.token)
    .maybeSingle();
  if (!agentData) notFound();
  const agent = agentData as unknown as AgentData;
  if (agent.archived) notFound();

  const orgName = agent.organization?.name || "Your team";
  const brand = accessibleBrand(agent.organization?.brand_color || DEFAULT_BRAND_COLOR);
  const brandBg = brandGradientCss(
    agent.organization?.brand_color,
    agent.organization?.brand_color_secondary,
  );
  const tz = agent.organization?.booking_timezone || "America/Toronto";
  const showingId = (searchParams.showing ?? "").trim();

  let row: ShowingRow | null = null;
  if (showingId && isUuid(showingId)) {
    const { data } = await admin
      .from("showings")
      .select("id, scheduled_at, outcome, lead:leads(name), property:properties(address)")
      .eq("id", showingId)
      .eq("assigned_agent_id", agent.id)
      .eq("organization_id", agent.organization_id)
      .maybeSingle();
    row = (data as unknown as ShowingRow | null) ?? null;
  }

  const renter = row?.lead?.name?.trim() || "this renter";
  const address = row?.property?.address?.trim() || "the property";
  const when = fmtWhen(row?.scheduled_at ?? null, tz);
  const currentOutcome =
    row?.outcome && row.outcome !== "scheduled" ? showingOutcomeLabel(row.outcome) : null;
  const formId = "agent-record-outcome";

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
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          {!row ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">
                We could not find that viewing
              </h1>
              <p className="mt-3 text-sm text-gray-600">
                Open your calendar to see the viewings currently assigned to you.
              </p>
              <a
                href={landingPath}
                className="mt-6 inline-block rounded-xl px-4 py-3 text-center text-base font-semibold text-white shadow-sm hover:opacity-95"
                style={{ background: brandBg }}
              >
                Open calendar
              </a>
            </>
          ) : currentOutcome ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900">Already recorded</h1>
              <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                Viewing for <span className="font-medium">{renter}</span> at{" "}
                <span className="font-medium">{address}</span> is already recorded as{" "}
                <span className="font-medium">{currentOutcome}</span>.
              </p>
              <a
                href={landingPath}
                className="mt-6 inline-block rounded-xl border border-gray-300 bg-white px-4 py-3 text-center text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
              >
                Open calendar
              </a>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-gray-900">
                Mark this viewing as {targetLabel(outcome)}?
              </h1>
              <p className="mt-3 text-sm text-gray-600">
                <span className="font-medium">{renter}</span> at{" "}
                <span className="font-medium">{address}</span>
                <br />
                <span className="text-gray-500">{when}</span>
              </p>
              <form id={formId} action={recordOutcomeFromToken} className="mt-6">
                <input type="hidden" name="token" value={params.token} />
                <input type="hidden" name="showing_id" value={row.id} />
                <input type="hidden" name="outcome" value={outcome} />
                <button
                  type="submit"
                  className="w-full rounded-xl px-4 py-3 text-center text-base font-semibold text-white shadow-sm hover:opacity-95"
                  style={{ background: brandBg }}
                >
                  Confirm
                </button>
              </form>
              <AutoSubmit formId={formId} />
            </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-400">Powered by Vacantless</p>
      </main>
    </div>
  );
}
