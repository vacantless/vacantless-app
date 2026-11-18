// S816b: Phone book. Every number in the account in one place, at your
// fingertips: your own numbers (texting, rental questions, arrival, emergency,
// your alert mobile, and any building or unit that has its own), your team
// (teammates, showing agents, trades), and one search over every renter,
// applicant and tenant. Each number: Call, Text, Copy.
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { loadTeam } from "@/lib/team-server";
import { PageHeader } from "@/components/ui";
import { CopyTextButton } from "@/components/copy-text-button";
import { dedupeBook, dialTarget, prettyPhone, BOOK_LEAD_COLS, BOOK_TENANT_COLS, BOOK_APP_COLS, type BookEntry } from "@/lib/phone-book";
import { PhoneSearch } from "./phone-search";
import { saveTeammateMobile } from "./actions";

export const dynamic = "force-dynamic";

type OwnNumber = { label: string; use: string; phone: string | null; change: string; canText: boolean };

function Actions({ phone, text = true }: { phone: string; text?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`tel:${dialTarget(phone)}`} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">
        Call
      </a>
      {text ? (
        <a href={`sms:${dialTarget(phone).split(",")[0]}`} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700">
          Text
        </a>
      ) : null}
      <CopyTextButton value={prettyPhone(phone)} label="Copy" copiedLabel="Copied" />
    </div>
  );
}

const TEAM_FLASH: Record<string, string> = {
  saved: "Saved.",
  bad: "That number looks too short. Use 10 digits.",
  forbidden: "Only the account owner can change someone else's number.",
  error: "Something went wrong. Please try again.",
};

export default async function PhoneBookPage({ searchParams }: { searchParams: { team?: string } }) {
  const org = await getCurrentOrg();
  if (!org) return null;
  const supabase = createClient();

  const [{ data: orgRow }, { data: smsRows }, { data: propRows }] = await Promise.all([
    supabase
      .from("organizations")
      .select("public_contact_phone, showing_arrival_phone, emergency_phone, alert_mobile_e164")
      .eq("id", org.id)
      .maybeSingle(),
    supabase.from("org_sms_numbers").select("phone_e164, enabled").eq("organization_id", org.id),
    supabase
      .from("properties")
      .select("id, address, showing_arrival_phone, emergency_phone")
      .eq("organization_id", org.id)
      .or("showing_arrival_phone.not.is.null,emergency_phone.not.is.null")
      .order("address"),
  ]);
  const o = (orgRow ?? {}) as {
    public_contact_phone?: string | null;
    showing_arrival_phone?: string | null;
    emergency_phone?: string | null;
    alert_mobile_e164?: string | null;
  };
  const texting = ((smsRows ?? []) as { phone_e164: string; enabled: boolean }[]).find((r) => r.enabled)?.phone_e164 ?? null;

  const own: OwnNumber[] = [
    {
      label: "Your texting number",
      use: "Renters and tenants text this number. Replies land in Vacantless.",
      phone: texting,
      change: "/dashboard/settings?tab=comms",
      canText: true,
    },
    {
      label: "Rental questions",
      use: "Shown on your ads and rental pages.",
      phone: o.public_contact_phone ?? null,
      change: "/dashboard/settings?tab=brand#public-contact-phone",
      canText: true,
    },
    {
      label: "Arrival number",
      use: "Renters call this when they arrive for a viewing.",
      phone: o.showing_arrival_phone ?? null,
      change: "/dashboard/settings?tab=comms",
      canText: true,
    },
    {
      label: "Emergency repairs",
      use: "Tenants call this for an emergency.",
      phone: o.emergency_phone ?? null,
      change: "/dashboard/maintenance",
      canText: true,
    },
    {
      label: "Your alert mobile",
      use: "Where Vacantless texts you about new renters and urgent repairs.",
      phone: o.alert_mobile_e164 ?? null,
      change: "/dashboard/settings?tab=comms",
      canText: true,
    },
  ];
  const props = (propRows ?? []) as {
    id: string;
    address: string;
    showing_arrival_phone: string | null;
    emergency_phone: string | null;
  }[];

  // Team: teammates (with the mobile saved here), showing agents, trades.
  const team = await loadTeam(org.id);
  const admin = createAdminClient();
  const mobileByMembership = new Map<string, string | null>();
  if (admin && team && team.members.length > 0) {
    const { data } = await admin
      .from("memberships")
      .select("id, mobile")
      .in("id", team.members.map((m) => m.membershipId));
    for (const r of (data ?? []) as { id: string; mobile: string | null }[]) mobileByMembership.set(r.id, r.mobile);
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: agentRows }, { data: tradeRows }, { data: leadRows }, { data: tenantRows }, { data: appRows }] =
    await Promise.all([
      supabase.from("showing_agents").select("id, name, phone, tier").eq("organization_id", org.id).eq("archived", false),
      supabase.from("trade_contacts").select("id, name, phone, trade_type").eq("organization_id", org.id).eq("archived", false),
      supabase
        .from("leads")
        .select(BOOK_LEAD_COLS)
        .eq("organization_id", org.id)
        .not("phone", "is", null)
        .order("created_at", { ascending: false })
        .limit(1500),
      supabase
        .from("tenants")
        .select(BOOK_TENANT_COLS)
        .eq("organization_id", org.id)
        .not("phone", "is", null),
      supabase
        .from("rental_applications")
        .select(BOOK_APP_COLS)
        .eq("organization_id", org.id)
        .not("applicant_phone", "is", null)
        .neq("status", "declined"),
    ]);

  const entries: BookEntry[] = [];
  for (const a of (agentRows ?? []) as { id: string; name: string; phone: string | null; tier: string | null }[]) {
    if (a.phone) entries.push({ key: `a-${a.id}`, name: a.name, phone: a.phone, kind: "Showing agent", detail: null, href: "/dashboard/showing-agents" });
  }
  for (const t of (tradeRows ?? []) as { id: string; name: string; phone: string | null; trade_type: string | null }[]) {
    if (t.phone) entries.push({ key: `t-${t.id}`, name: t.name, phone: t.phone, kind: "Trade", detail: t.trade_type, href: null });
  }
  for (const l of (leadRows ?? []) as unknown as { id: string; name: string | null; phone: string; property: { address: string } | null }[]) {
    entries.push({ key: `l-${l.id}`, name: l.name ?? "Renter", phone: l.phone, kind: "Renter", detail: l.property?.address ?? null, href: `/dashboard/leads/${l.id}` });
  }
  for (const a of (appRows ?? []) as unknown as { id: string; lead_id: string; applicant_name: string | null; applicant_phone: string; property: { address: string } | null }[]) {
    entries.push({ key: `p-${a.id}`, name: a.applicant_name ?? "Applicant", phone: a.applicant_phone, kind: "Applicant", detail: a.property?.address ?? null, href: `/dashboard/leads/${a.lead_id}#application` });
  }
  for (const t of (tenantRows ?? []) as unknown as {
    id: string;
    name: string;
    phone: string;
    person_id: string | null;
    tenancy: { id: string; status: string; property: { address: string } | null } | null;
  }[]) {
    if (t.tenancy && (t.tenancy.status === "ended" || t.tenancy.status === "cancelled")) continue;
    entries.push({
      key: `n-${t.id}`,
      name: t.name,
      phone: t.phone,
      kind: "Tenant",
      detail: t.tenancy?.property?.address ?? null,
      href: t.tenancy ? `/dashboard/tenancies/${t.tenancy.id}` : null,
    });
  }
  const book = dedupeBook(entries);
  const agents = book.filter((e) => e.kind === "Showing agent");
  const trades = book.filter((e) => e.kind === "Trade");

  return (
    <div>
      <PageHeader title="Phone book" subtitle="Every number in your account. Tap to call, text or copy." />

      <h2 className="mb-2 mt-2 text-xs font-medium uppercase tracking-wider text-gray-500">Your numbers</h2>
      <ul className="mb-8 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
        {own.map((n) => (
          <li key={n.label} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{n.label}</p>
              <p className="text-lg font-semibold tracking-wide text-gray-900">{n.phone ? prettyPhone(n.phone) : <span className="text-sm font-normal text-gray-400">Not set</span>}</p>
              <p className="text-xs text-gray-500">{n.use}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {n.phone ? <Actions phone={n.phone} text={n.canText} /> : null}
              <Link href={n.change} className="text-xs font-medium text-brand hover:underline">
                {n.phone ? "Change" : "Set it"}
              </Link>
            </div>
          </li>
        ))}
        {props.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">{p.address}</p>
              <p className="text-xs text-gray-500">
                {p.showing_arrival_phone ? `Arrival ${prettyPhone(p.showing_arrival_phone)}` : ""}
                {p.showing_arrival_phone && p.emergency_phone ? " · " : ""}
                {p.emergency_phone ? `Emergency ${prettyPhone(p.emergency_phone)}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {p.showing_arrival_phone ? <Actions phone={p.showing_arrival_phone} /> : p.emergency_phone ? <Actions phone={p.emergency_phone} /> : null}
              <Link href={`/dashboard/properties/${p.id}`} className="text-xs font-medium text-brand hover:underline">
                Change
              </Link>
            </div>
          </li>
        ))}
      </ul>

      <h2 id="team" className="mb-2 scroll-mt-6 text-xs font-medium uppercase tracking-wider text-gray-500">Your team</h2>
      {searchParams.team && TEAM_FLASH[searchParams.team] ? (
        <p className={`mb-2 rounded-lg border px-3 py-2 text-sm ${searchParams.team === "saved" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {TEAM_FLASH[searchParams.team]}
        </p>
      ) : null}
      <ul className="mb-8 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
        {(team?.members ?? []).map((m) => {
          const mobile = mobileByMembership.get(m.membershipId) ?? null;
          return (
            <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {m.email ?? "Teammate"}
                  {m.userId === user?.id ? " (you)" : ""}{" "}
                  <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Teammate</span>
                </p>
                <form action={saveTeammateMobile} className="mt-1 flex items-center gap-2">
                  <input type="hidden" name="membership_id" value={m.membershipId} />
                  <input
                    name="mobile"
                    type="tel"
                    inputMode="tel"
                    placeholder="Mobile"
                    defaultValue={mobile ? prettyPhone(mobile) : ""}
                    className="w-40 rounded-md border border-gray-300 px-2 py-1 text-sm"
                  />
                  <button type="submit" className="text-xs font-medium text-brand hover:underline">
                    Save
                  </button>
                </form>
              </div>
              {mobile ? <Actions phone={mobile} /> : null}
            </li>
          );
        })}
        {agents.map((e) => (
          <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">
              {e.name} <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Showing agent</span>
              <span className="block text-xs font-normal text-gray-500">{prettyPhone(e.phone)}</span>
            </p>
            <Actions phone={e.phone} />
          </li>
        ))}
        {trades.map((e) => (
          <li key={e.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm font-medium text-gray-900">
              {e.name} <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{e.detail ? `Trade · ${e.detail}` : "Trade"}</span>
              <span className="block text-xs font-normal text-gray-500">{prettyPhone(e.phone)}</span>
            </p>
            <Actions phone={e.phone} />
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">Renters, applicants and tenants</h2>
      <PhoneSearch entries={book.filter((e) => e.kind === "Renter" || e.kind === "Applicant" || e.kind === "Tenant")} />
    </div>
  );
}
