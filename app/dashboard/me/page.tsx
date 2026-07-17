import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import {
  PageHeader,
  SectionHeading,
  EmptyState,
  PRIMARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { PRODUCT_TYPES } from "@/lib/showing-agents";
import { updateMyCoverage } from "./actions";

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
  const flash = searchParams.me ? FLASH[searchParams.me] : null;

  return (
    <div>
      <PageHeader
        icon={<Icons.settings />}
        title="My settings"
        subtitle={`Your personal coverage and preferences for ${org.name}.`}
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

      {hasLinkedAgent ? (
        <MyCoverageCard me={me} />
      ) : (
        <EmptyState
          icon={<Icons.users className="h-5 w-5" />}
          title="You're not on this organization's showing roster yet."
          description="Ask an admin to add you so you can set your coverage."
        />
      )}
    </div>
  );
}

function MyCoverageCard({ me }: { me: MyAgent }) {
  const selected = new Set(me.product_types ?? []);
  const displayName = (me.name ?? "").trim() || "Unnamed agent";
  const tier = (me.tier ?? "").trim() || "-";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <SectionHeading>My coverage</SectionHeading>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="font-medium text-gray-900">{displayName}</span>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
          Tier: {tier} - set by your admin
        </span>
      </div>

      <form action={updateMyCoverage} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL}>Service area</label>
            <input
              name="service_area"
              defaultValue={me.service_area ?? ""}
              className={FIELD}
              placeholder="e.g. York Mills"
            />
          </div>
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
          <div className="flex flex-wrap gap-3">
            {PRODUCT_TYPES.map((p) => (
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
                {p}
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
