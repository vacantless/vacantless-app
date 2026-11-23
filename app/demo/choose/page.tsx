import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { AuthShell, AUTH_BUTTON_CLASS } from "@/components/auth-shell";
import { demoEmail, isDemoEmail } from "@/lib/demo-account";

export const dynamic = "force-dynamic";

// S833: a signed-in landlord pressed "See a live account". The homepage cannot
// tell they are signed in (it is on vacantless.com), so this page asks.
// Both choices are plain links: a prefetch of /demo?switch=1 would sign them out.
export default async function DemoChoosePage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/demo");
  if (isDemoEmail(user.email, demoEmail(process.env))) redirect("/dashboard");
  const org = await getCurrentOrg();
  const account = org?.name ? `${org.name} (${user.email})` : user.email ?? "your account";

  return (
    <AuthShell
      title="You are already signed in"
      subtitle={<>You are signed in to {account}. The live demo is a separate account with made-up rentals and renters.</>}
    >
      <div className="space-y-3">
        <a href="/dashboard" className={`block text-center ${AUTH_BUTTON_CLASS}`}>
          Go to my account
        </a>
        <a
          href="/demo?switch=1"
          className="block w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-center font-semibold text-gray-900 hover:border-gray-400"
        >
          Sign out and see the demo
        </a>
        <p className="text-sm text-gray-600">
          Signing out here only signs out this browser. Sign back in any time from Log in.
        </p>
      </div>
    </AuthShell>
  );
}
