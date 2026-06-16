import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { accessibleBrand } from "@/lib/brand-theme";
import { DashboardNav } from "./dashboard-nav";

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
    <div
      className="min-h-screen bg-slate-50"
      style={{ ["--brand-color" as string]: brand }}
    >
      <header
        className="relative text-white shadow-sm"
        style={{ backgroundColor: brand }}
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wider opacity-80">
              Vacantless · {org.plan}
            </p>
            <h1 className="text-lg font-bold">{org.name}</h1>
          </div>
          <DashboardNav />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
