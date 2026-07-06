import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganization } from "./actions";
import { OnboardingForm } from "./onboarding-form";
import { AuthShell } from "@/components/auth-shell";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { error?: string; ref?: string };
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
    <AuthShell
      eyebrow="Step 1 of 2"
      title="Set up your business profile"
      subtitle="Name your business and pick the brand color renters see on your pages and emails. You can change any of this later."
      footer="Next: add your first rental and share its inquiry page."
    >
      {/* gradient step indicator */}
      <div className="mb-6 flex items-center gap-2" aria-hidden>
        <span className="h-1.5 flex-1 rounded-full bg-gradient-to-r from-[#17362f] to-[#16756a]" />
        <span className="h-1.5 flex-1 rounded-full bg-gray-200" />
      </div>

      <OnboardingForm
        action={createOrganization}
        error={searchParams.error}
        referralToken={searchParams.ref}
      />
    </AuthShell>
  );
}
