import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/safe-next";

export async function POST(request: Request) {
  const supabase = createClient();
  await supabase.auth.signOut();
  // S828: "Sign in with another account" on a rental the current login cannot
  // open returns to that rental after the new login.
  let next: string | null = null;
  try {
    const form = await request.formData();
    const raw = form.get("next");
    if (typeof raw === "string" && raw.trim()) next = safeNextPath(raw);
  } catch {
    /* no form body: plain sign out */
  }
  const target = new URL("/login", request.url);
  if (next) target.searchParams.set("next", next);
  return NextResponse.redirect(target, { status: 302 });
}
