import Link from "next/link";
import { BrandBanner, Card, IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";

export const dynamic = "force-dynamic";

// ============================================================================
// Tenants hub (IA Step 1, S274) — the cross-unit "front door" for occupied
// units and the people in them. A thin landing that routes into the existing
// pages (Tenancies / People) and signposts where lease paperwork lives (inside
// a tenancy) — the G8 fix. It does NOT duplicate their lists.
//
// Per the IA rule: cross-unit queues that link INTO a tenancy's work, not
// parallel editors. The nav highlights "Tenants" on any child route.
// ============================================================================

type Section = {
  href: string;
  title: string;
  desc: string;
  icon: keyof typeof Icons;
};

const SECTIONS: Section[] = [
  {
    href: "/dashboard/tenancies",
    title: "Tenancies",
    desc: "Active leases across all units. Open a tenancy to manage the lease, rent setup, and tenant messages.",
    icon: "building",
  },
  {
    href: "/dashboard/people",
    title: "People",
    desc: "Everyone you've leased to, across tenancies — the contact record behind each tenant.",
    icon: "users",
  },
  {
    // S275 IA Step 3: clause library relocated here from its own Settings tab —
    // set clauses where you use them (when preparing a lease).
    href: "/dashboard/tenants/lease-clauses",
    title: "Lease clauses",
    desc: "Your reusable clause library. Build it once; pull clauses in when you prepare a lease.",
    icon: "list",
  },
  {
    // S305 work-order module Slice 2: maintenance lives with occupied-unit work.
    href: "/dashboard/maintenance",
    title: "Maintenance",
    desc: "Log repair issues, assign them to your own trades, and track each job to done. Costs you record feed your year-end statements.",
    icon: "bolt",
  },
];

export default function TenantsHubPage() {
  return (
    <div>
      <BrandBanner
        eyebrow="Tenants"
        title="Your occupied units"
        subtitle="Active leases and the people in them. Open a tenancy to handle its lease paperwork, rent setup, and messages."
        icon={<Icons.users className="h-6 w-6" />}
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

      {/* Lease paperwork signpost (G8): it lives inside a tenancy, not as its
          own top-level place. Point people there instead of leaving them to
          hunt for it. */}
      <Card className="mt-4 bg-gray-50">
        <div className="flex items-start gap-3.5">
          <IconTile>
            <Icons.list className="h-5 w-5" />
          </IconTile>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Lease paperwork</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              Leases are generated and stored inside each tenancy. Open a tenancy
              from{" "}
              <Link href="/dashboard/tenancies" className="font-medium text-brand underline">
                Tenancies
              </Link>{" "}
              to prepare or view its lease. Build your reusable{" "}
              <Link href="/dashboard/tenants/lease-clauses" className="font-medium text-brand underline">
                clause library
              </Link>{" "}
              first.
            </p>
          </div>
        </div>
      </Card>

      {/* Message templates bridge (S275 IA Step 3, G7): tenant message templates
          are set in Settings but used here when you message tenants. Point to
          where they're edited rather than leaving the link buried. */}
      <Card className="mt-4 bg-gray-50">
        <div className="flex items-start gap-3.5">
          <IconTile>
            <Icons.mail className="h-5 w-5" />
          </IconTile>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900">Message templates</h2>
            <p className="mt-1 text-sm leading-relaxed text-gray-600">
              Save reusable email and text templates for tenant messages. Manage
              them in{" "}
              <Link
                href="/dashboard/settings?tab=comms"
                className="font-medium text-brand underline"
              >
                Settings → Communications
              </Link>
              .
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
