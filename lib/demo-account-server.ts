import { createClient } from "@/lib/supabase/server";
import { demoEmail, isDemoEmail } from "@/lib/demo-account";

// S800: is the signed-in login the shared demo login? False whenever the demo
// is not configured, so nothing changes for any real account.
export async function isDemoSession(): Promise<boolean> {
  const configured = demoEmail(process.env);
  if (!configured) return false;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isDemoEmail(user?.email, configured);
}
