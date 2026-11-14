import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { PageHeader, SectionHeading, PRIMARY_ACTION_CLASS, SECONDARY_ACTION_CLASS } from "@/components/ui";
import { Icons } from "@/components/icons";
import { CopyLinkButton } from "@/components/copy-link-button";
import { CREW_ROLES, CREW_ROLE_LABEL, STAGE_LABEL, TAP_ORDER, stageDateLine } from "@/lib/unit-progress";
import { unitCardsForOrg } from "@/lib/unit-progress-server";
import { addCrewMember, newCrewLink, setCrewMemberActive, setUnitStage, switchOffShootLink } from "./actions";

export const dynamic = "force-dynamic";

// S788b: unit progress (PLAN-S788-UNIT-PROGRESS). The landlord adds the crew
// (manager, leasing, contractor, cleaner, photographer), sends each person
// their own no-login link, and sees every unit's stage and who set it.

type Crew = { id: string; name: string; role: string; contact: string | null; link_token: string; active: boolean };

const FLASH: Record<string, { tone: "ok" | "err"; text: string }> = {
  added: { tone: "ok", text: "Added. Copy their link and send it to them." },
  on: { tone: "ok", text: "Their link works again." },
  off: { tone: "ok", text: "Their link is switched off." },
  new_link: { tone: "ok", text: "New link made. The old one no longer works." },
  stage_saved: { tone: "ok", text: "Stage saved." },
  shoot_link: { tone: "ok", text: "Stage saved. Copy the photographer's link under the unit and send it to them. It works once." },
  shoot_off: { tone: "ok", text: "The photographer's link is switched off." },
  name_required: { tone: "err", text: "A name is needed." },
  role_required: { tone: "err", text: "Pick what they do." },
  stage_invalid: { tone: "err", text: "Mark a rented unit on its rental page. That takes the ads down." },
  forbidden: { tone: "err", text: "You don't have permission to change this." },
  error: { tone: "err", text: "That did not save. Please try again." },
};

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand";

function fmtWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

export default async function CrewPage({ searchParams }: { searchParams: { crew?: string } }) {
  await requireCapability("manage_settings", "/dashboard?forbidden=1");
  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return null;
  const tz = org.booking_timezone || "America/Toronto";

  const [{ data: crewData }, cards] = await Promise.all([
    supabase.from("crew_members").select("id, name, role, contact, link_token, active").eq("organization_id", org.id).order("name"),
    unitCardsForOrg(supabase, org.id),
  ]);
  const crew = (crewData ?? []) as Crew[];
  const flash = searchParams.crew ? FLASH[searchParams.crew] : null;
  const landlordStages = TAP_ORDER.filter((st) => st !== "rented");

  return (
    <div>
      <PageHeader
        icon={<Icons.wrench />}
        title="Unit progress"
        subtitle="Give your manager, contractor, cleaner and photographer their own link. They tap where each unit is at, with no sign in. You see it here. A Rented tap takes the ads down. You can put them back up from the rental page. Some stages take a date, like a move out day. Photographer booked makes a one-time link for that shoot."
      />

      {flash && (
        <div className={`mb-6 rounded-lg border px-4 py-3 text-sm ${flash.tone === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {flash.text}
        </div>
      )}

      <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <SectionHeading>Your crew</SectionHeading>
        {crew.length === 0 && <p className="mt-2 text-sm text-gray-600">No one yet. Add the first person below.</p>}
        <ul className="mt-3 divide-y divide-gray-100">
          {crew.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {c.name} <span className="font-normal text-gray-500">{CREW_ROLE_LABEL[c.role as keyof typeof CREW_ROLE_LABEL] ?? c.role}</span>
                </p>
                {c.contact && <p className="text-xs text-gray-500">{c.contact}</p>}
                {!c.active && <p className="text-xs text-amber-700">Link switched off</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {c.active && <CopyLinkButton path={`/crew/${c.link_token}`} label="Copy their link" />}
                <form action={setCrewMemberActive}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                  <button type="submit" className={SECONDARY_ACTION_CLASS}>{c.active ? "Switch link off" : "Switch link on"}</button>
                </form>
                <form action={newCrewLink}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className={SECONDARY_ACTION_CLASS}>New link</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
        <form action={addCrewMember} className="mt-4 grid gap-3 sm:grid-cols-4">
          <input name="name" placeholder="Name" className={FIELD} required maxLength={120} />
          <select name="role" className={FIELD} defaultValue="" required>
            <option value="" disabled>What they do</option>
            {CREW_ROLES.map((r) => (
              <option key={r} value={r}>{CREW_ROLE_LABEL[r]}</option>
            ))}
          </select>
          <input name="contact" placeholder="Phone or email, if you like" className={FIELD} maxLength={200} />
          <button type="submit" className={`${PRIMARY_ACTION_CLASS} bg-brand`}>Add</button>
        </form>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <SectionHeading>Where each unit is at</SectionHeading>
        <ul className="mt-3 divide-y divide-gray-100">
          {cards.map((p) => {
            const l = p.stage && p.stageAt ? { stage: p.stage, at: p.stageAt, by: p.stageBy } : null;
            return (
              <li key={p.id} id={`u-${p.id}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/dashboard/properties/${p.id}`} className="text-sm font-medium text-gray-900 hover:underline">
                    {p.address}
                  </Link>
                  <p className="text-xs text-gray-500">
                    {l ? `${STAGE_LABEL[l.stage]}${p.stageDate ? `, ${stageDateLine(l.stage, p.stageDate).toLowerCase()}` : ""} · ${fmtWhen(l.at, tz)}${l.by ? ` by ${l.by}` : ""}` : "No stage yet"}
                  </p>
                  {p.shootToken && (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-sky-800">Photographer{p.shootPhotographer ? ` ${p.shootPhotographer}` : ""}: one-time link</span>
                      <CopyLinkButton path={`/crew/shoot/${p.shootToken}`} label="Copy their link" />
                      <form action={switchOffShootLink}>
                        <input type="hidden" name="id" value={p.shootLinkId ?? ""} />
                        <button type="submit" className="text-xs text-gray-500 underline">Switch off</button>
                      </form>
                    </div>
                  )}
                </div>
                <form action={setUnitStage} className="flex gap-2">
                  <input type="hidden" name="property_id" value={p.id} />
                  <select name="stage" className={FIELD} defaultValue={l && l.stage !== "rented" ? l.stage : ""}>
                    <option value="" disabled>Set stage</option>
                    {landlordStages.map((st) => (
                      <option key={st} value={st}>{STAGE_LABEL[st]}</option>
                    ))}
                  </select>
                  <input type="date" name="due_date" aria-label="Date, if the stage has one" className={FIELD} />
                  <button type="submit" className={SECONDARY_ACTION_CLASS}>Save</button>
                </form>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
