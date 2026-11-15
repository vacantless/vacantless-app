import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEMO_ORG_ID, demoEmail } from "@/lib/demo-account";

export const dynamic = "force-dynamic";

// S800: "See a live account". Signs the visitor in as the shared demo login in
// the Lakeview Rentals test account. No password exists: the server asks Supabase
// for a one-time sign-in token for the demo address and uses it at once.
// Middleware blocks every write for this login (lib/demo-account.ts).
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const home = NextResponse.redirect(new URL("/", origin));
  const configured = demoEmail(process.env);
  if (!configured) return home;

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Already signed in: a real landlord keeps their own account; the demo login just continues.
  if (user) {
    return NextResponse.redirect(new URL("/dashboard", origin));
  }

  const admin = createAdminClient();
  if (!admin) return home;

  // Make the demo login once; later visits find it already there.
  const created = await admin.auth.admin.createUser({ email: configured, email_confirm: true });
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email: configured });
  const hashed = link.data?.properties?.hashed_token;
  const demoUserId = link.data?.user?.id ?? created.data?.user?.id ?? null;
  if (!hashed || !demoUserId) return home;

  // The demo login belongs to Lakeview Rentals and nothing else.
  const { data: existing } = await admin
    .from("memberships")
    .select("id")
    .eq("organization_id", DEMO_ORG_ID)
    .eq("user_id", demoUserId)
    .maybeSingle();
  if (!existing) {
    const { error } = await admin
      .from("memberships")
      .insert({ organization_id: DEMO_ORG_ID, user_id: demoUserId, role: "operator" });
    if (error) return home;
  }

  const { error: signInError } = await supabase.auth.verifyOtp({
    token_hash: hashed,
    type: "magiclink",
  });
  if (signInError) return home;

  return NextResponse.redirect(new URL("/dashboard", origin));
}
