import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/membership";
import {
  PageHeader,
  SectionHeading,
  EmptyState,
  PRIMARY_ACTION_CLASS,
  SECONDARY_ACTION_CLASS,
} from "@/components/ui";
import { Icons } from "@/components/icons";
import { PRODUCT_TYPES } from "@/lib/showing-agents";
import {
  createShowingAgent,
  updateShowingAgent,
  setShowingAgentArchived,
} from "./actions";

export const dynamic = "force-dynamic";

type Agent = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  tier: string | null;
  service_area: string | null;
  product_types: string[] | null;
  weekly_capacity: number | null;
  note: string | null;
  archived: boolean;
};

const FLASH: Record<string, { tone: "ok" | "err"; text: string }> = {
  saved: { tone: "ok", text: "Showing agent saved." },
  archived: { tone: "ok", text: "Agent archived. They no longer appear in the assignment picker." },
  restored: { tone: "ok", text: "Agent restored." },
  name_required: { tone: "err", text: "A name is required." },
  name_too_long: { tone: "err", text: "That name is too long." },
  email_invalid: { tone: "err", text: "That email doesn't look right." },
  capacity_invalid: { tone: "err", text: "Weekly capacity must be a whole number, 0 or more." },
  forbidden: { tone: "err", text: "You don't have permission to manage showing agents." },
  missing: { tone: "err", text: "That agent could not be found." },
};

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";
const LABEL = "block text-xs font-medium text-gray-600 mb-1";

export default async function ShowingAgentsPage({
  searchParams,
}: {
  searchParams: { agent?: string };
}) {
  await requireCapability("manage_settings", "/dashboard/showings?forbidden=1");
  const supabase = createClient();
  const { data } = await supabase
    .from("showing_agents")
    .select(
      "id, name, email, phone, tier, service_area, product_types, weekly_capacity, note, archived",
    )
    .order("name", { ascending: true });
  const agents = (data ?? []) as Agent[];
  const active = agents.filter((a) => !a.archived);
  const archived = agents.filter((a) => a.archived);

  const flash = searchParams.agent ? FLASH[searchParams.agent] : null;

  return (
    <div>
      <PageHeader
        icon={<Icons.users />}
        title="Showing agents"
        subtitle="Your team of showing agents. Add the people who run viewings for you, then assign each viewing to one from the Viewings page. Assigning emails them the renter, property, and time so they can coordinate it."
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

      {/* Add an agent */}
      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <SectionHeading>Add a showing agent</SectionHeading>
        <AgentFields action={createShowingAgent} submitLabel="Add agent" />
      </div>

      {/* Active roster */}
      <div className="mb-8">
        <SectionHeading>Your agents ({active.length})</SectionHeading>
        {active.length === 0 ? (
          <EmptyState
            icon={<Icons.users className="h-5 w-5" />}
            title="No showing agents yet"
            description="Add your first showing agent above. Once you have agents, you can route each viewing to the right person from the Viewings page."
          />
        ) : (
          <ul className="space-y-3">
            {active.map((a) => (
              <li
                key={a.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {a.name}
                      {a.tier ? (
                        <span className="ml-2 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600">
                          {a.tier}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {[
                        a.email,
                        a.phone,
                        a.service_area,
                        a.weekly_capacity != null
                          ? `${a.weekly_capacity}/week`
                          : null,
                        a.product_types && a.product_types.length > 0
                          ? a.product_types.join(", ")
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "No contact details yet"}
                    </p>
                    {a.note ? (
                      <p className="mt-1 text-xs text-gray-500">{a.note}</p>
                    ) : null}
                  </div>
                  <form action={setShowingAgentArchived}>
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="archived" value="true" />
                    <button type="submit" className={SECONDARY_ACTION_CLASS}>
                      Archive
                    </button>
                  </form>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-medium text-brand">
                    Edit
                  </summary>
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <AgentFields
                      action={updateShowingAgent}
                      submitLabel="Save changes"
                      agent={a}
                    />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Archived */}
      {archived.length > 0 && (
        <div className="mb-8">
          <SectionHeading>Archived ({archived.length})</SectionHeading>
          <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white shadow-sm">
            {archived.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <span className="text-sm text-gray-500">{a.name}</span>
                <form action={setShowingAgentArchived}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="archived" value="false" />
                  <button
                    type="submit"
                    className="text-xs font-medium text-brand hover:underline"
                  >
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Shared field set for create + edit. On edit, `agent` prefills the inputs and a
// hidden id is posted.
function AgentFields({
  action,
  submitLabel,
  agent,
}: {
  action: (formData: FormData) => void;
  submitLabel: string;
  agent?: Agent;
}) {
  const selected = new Set(agent?.product_types ?? []);
  return (
    <form action={action} className="mt-3 space-y-3">
      {agent ? <input type="hidden" name="id" value={agent.id} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL}>Name *</label>
          <input name="name" required defaultValue={agent?.name ?? ""} className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>Email</label>
          <input
            name="email"
            type="email"
            defaultValue={agent?.email ?? ""}
            className={FIELD}
            placeholder="Where their assignment emails go"
          />
        </div>
        <div>
          <label className={LABEL}>Phone</label>
          <input name="phone" defaultValue={agent?.phone ?? ""} className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>Tier</label>
          <input
            name="tier"
            defaultValue={agent?.tier ?? ""}
            className={FIELD}
            placeholder="e.g. lead, associate, helper"
          />
        </div>
        <div>
          <label className={LABEL}>Service area</label>
          <input
            name="service_area"
            defaultValue={agent?.service_area ?? ""}
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
            defaultValue={agent?.weekly_capacity ?? ""}
            className={FIELD}
            placeholder="Max viewings/week (optional)"
          />
        </div>
      </div>
      <div>
        <label className={LABEL}>Handles</label>
        <div className="flex flex-wrap gap-3">
          {PRODUCT_TYPES.map((p) => (
            <label key={p} className="inline-flex items-center gap-1.5 text-sm text-gray-700">
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
      <div>
        <label className={LABEL}>Note</label>
        <input name="note" defaultValue={agent?.note ?? ""} className={FIELD} />
      </div>
      <button type="submit" className={`${PRIMARY_ACTION_CLASS} bg-brand`}>
        {submitLabel}
      </button>
    </form>
  );
}
