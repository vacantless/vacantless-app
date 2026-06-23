import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { accessibleBrand, brandGradientCss } from "@/lib/brand-theme";
import { isRentCollectionActive } from "@/lib/rent-status";
import { DashboardNav } from "./dashboard-nav";
import { VacantlessMark } from "@/components/vacantless-mark";

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
  // The tenant's brand surface: a two-stop ombre when they picked one, else the
  // solid (both legibility-guarded). Flows through --brand-gradient so every
  // primitive (icon tiles, banners, CTAs) carries the depth, while --brand-color
  // stays the solid for anything that needs a single color.
  const brandGradient = brandGradientCss(org.brand_color, org.brand_color_secondary);

  // Conditional "Money" nav item (IA Step 1, S274): show it only when rent
  // collection is actually active — Stripe charges_enabled OR Rotessa connected.
  // RLS scopes both reads to this org; we select only the status fields needed.
  const [{ data: stripeRows }, { data: rotessaRows }] = await Promise.all([
    supabase.from("stripe_connect_accounts").select("charges_enabled").limit(1),
    supabase.from("rotessa_accounts").select("connection_status").limit(1),
  ]);
  const rentActive = isRentCollectionActive({
    stripeChargesEnabled: (stripeRows?.[0] as { charges_enabled?: boolean } | undefined)
      ?.charges_enabled ?? null,
    rotessaConnectionStatus: (rotessaRows?.[0] as { connection_status?: string } | undefined)
      ?.connection_status ?? null,
  });

  return (
    <div
      className="relative min-h-screen bg-slate-50"
      style={{
        ["--brand-color" as string]: brand,
        ["--brand-gradient" as string]: brandGradient,
      }}
    >
      {/* Soft brand wash for depth — bleeds out from behind the header. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full opacity-20 blur-3xl"
        style={{ background: brandGradient }}
      />
      <header
        className="relative z-30 text-white shadow-md print:hidden"
        style={{ background: brandGradient }}
      >
        {/* subtle top sheen so the band reads as dimensional, not flat */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25"
        />
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <VacantlessMark
              variant="white"
              className="h-8 w-8 shrink-0 drop-shadow-sm"
            />
            <div>
              <p className="text-xs uppercase tracking-wider opacity-80">
                Vacantless · {org.plan}
              </p>
              <h1 className="text-lg font-bold">{org.name}</h1>
            </div>
          </div>
          <DashboardNav rentActive={rentActive} />
        </div>
      </header>
      <main className="relative z-10 mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
