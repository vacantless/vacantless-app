import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addProperty } from "./actions";

export const dynamic = "force-dynamic";

type Org = {
  id: string;
  name: string;
  brand_color: string;
  plan: string;
};

export default async function DashboardPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes this to the caller's org only.
  const { data: orgs } = await supabase
    .from("organizations")
    .select("id, name, brand_color, plan");

  if (!orgs || orgs.length === 0) redirect("/onboarding");
  const org = orgs[0] as Org;

  const { data: properties } = await supabase
    .from("properties")
    .select("id, address, rent_cents, status")
    .order("created_at", { ascending: false });

  return (
    <main
      className="min-h-screen"
      style={{ ["--brand-color" as string]: org.brand_color }}
    >
      <header
        className="flex items-center justify-between px-6 py-4 text-white"
        style={{ backgroundColor: org.brand_color }}
      >
        <div>
          <p className="text-xs uppercase tracking-wider opacity-80">
            Vacantless · {org.plan}
          </p>
          <h1 className="text-xl font-bold">{org.name}</h1>
        </div>
        <form action="/auth/signout" method="post">
          <button className="rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/30">
            Sign out
          </button>
        </form>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          Signed in as <span className="font-medium">{user.email}</span>. You are
          seeing only <span className="font-medium">{org.name}</span>&apos;s data —
          Postgres row-level security blocks every other tenant&apos;s rows.
        </div>

        <h2 className="mb-3 text-lg font-semibold text-gray-900">Properties</h2>
        {properties && properties.length > 0 ? (
          <ul className="mb-6 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {properties.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <span className="text-gray-900">{p.address}</span>
                <span className="text-sm text-gray-500">
                  {p.rent_cents
                    ? `$${(p.rent_cents / 100).toLocaleString()}/mo`
                    : "—"}{" "}
                  · {p.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-6 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center text-sm text-gray-500">
            No properties yet. Add your first below.
          </p>
        )}

        <form
          action={addProperty}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
        >
          <input type="hidden" name="organization_id" value={org.id} />
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Address
            </label>
            <input
              name="address"
              required
              placeholder="833 Pillette Rd, Unit 20"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="w-28">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Rent ($/mo)
            </label>
            <input
              name="rent"
              type="number"
              step="1"
              placeholder="1250"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: org.brand_color }}
          >
            Add property
          </button>
        </form>
      </section>
    </main>
  );
}
