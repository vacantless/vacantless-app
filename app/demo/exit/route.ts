import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { demoEmail, isDemoEmail, isPrefetch } from "@/lib/demo-account";

export const dynamic = "force-dynamic";

// S800: leave the demo. Only ever signs out the demo login, so a real
// landlord who opens this address is left signed in.
export async function GET(request: NextRequest) {
  // S800b: a prefetch is not a click. Never sign out on one.
  if (isPrefetch(request.headers)) return new NextResponse(null, { status: 204 });
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user && isDemoEmail(user.email, demoEmail(process.env))) {
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/", request.nextUrl.origin));
}
