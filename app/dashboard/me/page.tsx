import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  PageHeader,
  SectionHeading,
  PRIMARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { RENTAL_SHAPE_LABEL, RENTAL_SHAPE_TYPES } from "@/lib/showing-agents";
import type { AssignedView } from "@/lib/dashboard-assigned";
import { updateMyCoverage, updateMyDashboardDefaults } from "./actions";

export const dynamic = "force-dynamic";

type MyAgent = {
  id: string;
  name: string | null;
  tier: string | null;
  service_area: string | null;
  product_types: string[] | null;
  weekly_capacity: number | null;
};

const FLASH: Record<string, { tone: "ok" | "err"; text: string }> = {
  saved: { tone: "ok", text: "Coverage saved." },
  defaults_saved: { tone: "ok", text: "Dashboard defaults saved." },
  capacity_invalid: { tone: "err", text: "Weekly capacity must be a whole number, 0 or more." },
  not_linked: { tone: "err", text: "You're not on the showing roster, so there's no coverage to save." },
};

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL = "block text-xs font-medium text-gray-600 mb-1";

export default async function MySettingsPage({
  searchParams,
}: {
  searchParams: { me?: string };
}) {
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/onboarding");

  const { data: rows } = await supabase
    .from("showing_agents")
    .select("id, name, tier, service_area, product_types, weekly_capacity")
    .eq("user_id", user.id)
    .eq("organization_id", org.id)
    .eq("archived", false)
    .limit(1);
  const me: MyAgent | null = (rows as MyAgent[] | null)?.[0] ?? null;
  const hasLinkedAgent = me != null;
  let defaultView: AssignedView = "mine";
  if (hasLinkedAgent) {
    const { data: prefRows } = await supabase
      .from("user_preferences")
      .select("default_assigned_view")
      .eq("user_id", user.id)
      .eq("organization_id", org.id)
      .limit(1);
    const v = (
      prefRows as { default_assigned_view: string | null }[] | null
    )?.[0]?.default_assigned_view;
    defaultView = v === "team" ? "team" : "mine";
  }
  const flash = searchParams.me ? FLASH[searchParams.me] : null;

  return (
    <div>
      <PageHeader
        icon={<Icons.settings />}
        title="My settings"
        subtitle={`Your sign-in and your own settings for ${org.name}.`}
      />

      {flash && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            flash.tone === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {flash.text}
        </div>
      )}

      <div className="space-y-6">
        {/* S792: every person has something here, not an empty box. */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-900">Your sign-in</h3>
          <p className="mt-1 text-sm text-gray-600">
            You sign in as <span className="font-medium text-gray-900">{user.email ?? "your email"}</span>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/forgot-password" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Change my password
            </Link>
            <Link href="/dashboard/automations" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Choose which emails I get
            </Link>
            <Link href="/dashboard/settings?tab=team" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Add a teammate
            </Link>
          </div>
        </div>
        {hasLinkedAgent ? (
          <>
            <MyCoverageCard me={me} />
            <DashboardDefaultsCard defaultView={defaultView} />
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-5">
            <h3 className="text-sm font-semibold text-gray-900">Do you show the rentals yourself?</h3>
            <p className="mt-1 text-sm text-gray-600">
              Add yourself as a showing agent. Then you set the times you can cover here.
            </p>
            <Link href="/dashboard/showing-agents" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">
              Open Showing agents
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardDefaultsCard({ defaultView }: { defaultView: AssignedView }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <SectionHeading>Dashboard defaults</SectionHeading>
      <form action={updateMyDashboardDefaults} className="space-y-4">
        <div>
          <label className={LABEL}>Default viewings view</label>
          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="radio"
                name="default_assigned_view"
                value="mine"
                defaultChecked={defaultView === "mine"}
                className="border-gray-300 text-brand focus:ring-brand"
              />
              My viewings
            </label>
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <input
                type="radio"
                name="default_assigned_view"
                value="team"
                defaultChecked={defaultView === "team"}
                className="border-gray-300 text-brand focus:ring-brand"
              />
              Team
            </label>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Which viewings the dashboard shows first when you open it. You can
            still switch anytime.
          </p>
        </div>

        <button type="submit" className={`${PRIMARY_ACTION_CLASS} bg-brand`}>
          Save defaults
        </button>
      </form>
    </div>
  );
}

function MyCoverageCard({ me }: { me: MyAgent }) {
  const selected = new Set(me.product_types ?? []);
  const displayName = (me.name ?? "").trim() || "Unnamed agent";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <SectionHeading>My coverage</SectionHeading>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="font-medium text-gray-900">{displayName}</span>
      </div>

      <form action={updateMyCoverage} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Weekly capacity</label>
            <input
              name="weekly_capacity"
              type="number"
              min={0}
              step={1}
              defaultValue={me.weekly_capacity ?? ""}
              className={FIELD}
              placeholder="Max viewings/week"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank for no weekly cap.
            </p>
          </div>
        </div>

        <div>
          <label className={LABEL}>Handles</label>
          <p className="mb-1.5 text-xs text-gray-500">
            Automatic assignment sends you only these kinds of rentals. Leave all unticked for every rental.
          </p>
          <div className="flex flex-wrap gap-3">
            {RENTAL_SHAPE_TYPES.map((p) => (
              <label
                key={p}
                className="inline-flex items-center gap-1.5 text-sm text-gray-700"
              >
                <input
                  type="checkbox"
                  name="product_types"
                  value={p}
                  defaultChecked={selected.has(p)}
                  className="rounded border-gray-300 text-brand focus:ring-brand"
                />
                {RENTAL_SHAPE_LABEL[p]}
              </label>
            ))}
          </div>
        </div>

        <button type="submit" className={`${PRIMARY_ACTION_CLASS} bg-brand`}>
          Save coverage
        </button>
      </form>
    </div>
  );
}
