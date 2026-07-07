import Link from "next/link";
import { BrandBanner, Card, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Leasing hub (IA Step 1, S274) — the cross-unit "front door" for everything
// about converting an interested renter. A thin landing that routes into the
// existing pages (Inquiries / Viewings / Availability); it does NOT duplicate
// their lists. The richer cross-unit queue view comes in a later step.
//
// Per the IA rule: these are cross-unit queues that link INTO a unit's work —
// not parallel editors. The nav highlights "Leasing" while you're on any child
// route (see dashboard-nav `match`).
// ============================================================================

type Section = {
  href: string;
  title: string;
  desc: string;
  icon: keyof typeof Icons;
};

const SECTIONS: Section[] = [
  {
    href: "/dashboard/leads",
    title: "Inquiries",
    desc: "Every renter inquiry across all your rentals — reply, qualify, and move them through your follow-up list.",
    icon: "chat",
  },
  {
    href: "/dashboard/showings",
    title: "Viewings",
    desc: "Booked viewings and their outcomes, across all units.",
    icon: "calendar",
  },
  {
    href: "/dashboard/availability",
    title: "Availability",
    desc: "Set the viewing times renters can book — this is the setup behind Viewings.",
    icon: "clock",
  },
  {
    // S275 IA Step 3: pre-screening relocated here from Settings — it's a
    // pipeline rule, so it lives where you work inquiries.
    href: "/dashboard/leasing/screening",
    title: "Pre-screening",
    desc: "Add qualifying questions to your inquiry form and auto-flag renters who likely don't fit. You always decide.",
    icon: "users",
  },
  {
    // The leasing FUNNEL report (inquiries -> viewings -> leases, by channel).
    // Money reports (owner statement / rent roll) live under the Money hub.
    href: "/dashboard/reports",
    title: "Reports",
    desc: "Your leasing funnel across all rentals - inquiries, viewings, channels, and how long units take to lease.",
    icon: "chart",
  },
];

export default function LeasingHubPage() {
  return (
    <div>
      <BrandBanner
        eyebrow="Leasing"
        title="Convert your inquiries"
        subtitle="Everything that needs you across all your rentals — inquiries, viewings, and the times renters can book. Open any rental to work a single unit end-to-end."
        icon={<Icons.key className="h-6 w-6" />}
      />

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const Icon = Icons[s.icon];
          return (
            <Link key={s.href} href={s.href} className="block">
              <Card hover className="h-full">
                <div className="flex items-start gap-3.5">
                  <IconTile>
                    <Icon className="h-5 w-5" />
                  </IconTile>
                  <div className="min-w-0">
                    <h2 className="font-semibold text-gray-900">{s.title}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">
                      {s.desc}
                    </p>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
