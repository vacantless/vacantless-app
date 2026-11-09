import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createOrganization } from "./actions";
import { OnboardingForm } from "./onboarding-form";
import { AuthShell } from "@/components/auth-shell";
import { onboardingNextStep } from "@/lib/signup-copy";
import { openInvitesForEmail } from "@/lib/team-server";
import { teamRoleLabel } from "@/lib/team";
import { acceptInviteById } from "@/app/join/actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { error?: string; ref?: string; plan?: string; own?: string; e?: string };
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

  // S744: someone invited this email to their team. Offer that first, so a
  // teammate never sets up a second, empty account by mistake.
  const invites = await openInvitesForEmail(user.email);
  if (invites.length > 0 && searchParams.own !== "1") {
    return (
      <AuthShell
        eyebrow="Team invite"
        title="You're invited to a team"
        subtitle="Join to share their rentals, renters and viewings."
      >
        {searchParams.e && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {searchParams.e === "email_not_confirmed"
              ? "Confirm your email first. Then come back here."
              : "That invite couldn't be used. Ask for a new one."}
          </div>
        )}
        <div className="space-y-3">
          {invites.map((inv) => (
            <form key={inv.id} action={acceptInviteById}>
              <input type="hidden" name="invite_id" value={inv.id} />
              <button className="w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
                Join {inv.org_name} as a {teamRoleLabel(inv.role).toLowerCase()}
              </button>
            </form>
          ))}
        </div>
        <a
          href="/onboarding?own=1"
          className="mt-5 block text-center text-sm text-gray-500 underline"
        >
          Set up my own account instead
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Step 1 of 2"
      title="Set up your business profile"
      subtitle="Name your business and add the phone renters can call. Your first rental is next."
      footer={onboardingNextStep(searchParams.plan)}
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
        planIntent={searchParams.plan}
      />
    </AuthShell>
  );
}
