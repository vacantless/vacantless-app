import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { accessibleBrand } from "@/lib/brand-theme";
import { NavLink } from "./nav-link";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  // Guardrail: a pale tenant brand color makes the white header text + the
  // white-on-brand buttons unreadable. Derive an accessible (darkened-as-needed)
  // variant and flow it through --brand-color so every consumer — the header,
  // primary buttons, the launch checklist, EmptyState CTAs, and text-brand
  // accents — stays legible.
  const brand = accessibleBrand(org.brand_color);

  return (
    <div style={{ ["--brand-color" as string]: brand }}>
      <header className="text-white" style={{ backgroundColor: brand }}>
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80">
              Vacantless · {org.plan}
            </p>
            <h1 className="text-lg font-bold">{org.name}</h1>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <NavLink href="/dashboard">Overview</NavLink>
            <NavLink href="/dashboard/properties">Properties</NavLink>
            <NavLink href="/dashboard/leads">Leads</NavLink>
            <NavLink href="/dashboard/showings">Showings</NavLink>
            <NavLink href="/dashboard/availability">Availability</NavLink>
            <NavLink href="/dashboard/reports">Reports</NavLink>
            <NavLink href="/dashboard/billing">Billing</NavLink>
            <NavLink href="/dashboard/settings">Settings</NavLink>
            <form action="/auth/signout" method="post" className="ml-2">
              <button className="rounded-lg bg-white/20 px-3 py-1.5 font-medium hover:bg-white/30">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
