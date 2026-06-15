import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganization } from "./actions";
import { OnboardingForm } from "./onboarding-form";

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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand">
        Vacantless
      </p>
      <p className="mt-6 text-xs font-medium uppercase tracking-wider text-gray-400">
        Step 1 of 2
      </p>
      <h1 className="mt-1 text-2xl font-bold text-gray-900">
        Create your workspace
      </h1>
      <p className="mt-2 text-sm text-gray-600">
        This creates your branded leasing workspace — the home for your
        properties, leads, and showings. You can change any of these settings
        later in Settings.
      </p>

      <OnboardingForm action={createOrganization} error={searchParams.error} />

      <p className="mt-6 text-center text-xs text-gray-400">
        Next: add your first property and share its intake page.
      </p>
    </main>
  );
}
