import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganization } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Already a member of an org → skip onboarding.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("organization_id")
    .limit(1);
  if (memberships && memberships.length > 0) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-bold text-gray-900">
        Set up your organization
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        This is your branded workspace. You can change it later.
      </p>
      <form action={createOrganization} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Organization name
          </label>
          <input
            name="name"
            required
            placeholder="Agile Real Estate Group"
            className="w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Brand color
          </label>
          <input
            name="brand_color"
            type="color"
            defaultValue="#4f46e5"
            className="h-10 w-20 rounded border border-gray-300"
          />
        </div>
        {searchParams.error && (
          <p className="text-sm text-red-600">{searchParams.error}</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-brand px-4 py-2 font-medium text-white"
        >
          Create workspace
        </button>
      </form>
    </main>
  );
}
