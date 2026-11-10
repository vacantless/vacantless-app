// S744 (roadmap item 14): Settings > Team. Everyone on the account sees who is
// on it; only the owner can invite, cancel or remove.

import Link from "next/link";
import { loadTeam } from "@/lib/team-server";
import { INVITABLE_ROLES, seatsLeft, teammateLimit, teamRoleBlurb, teamRoleLabel } from "@/lib/team";
import { IconTile } from "@/components/ui";
import { Icons } from "@/components/icons";
import { cancelTeamInvite, inviteTeammate, removeTeammate } from "./team-actions";
import { DEFAULT_TIME_ZONE } from "@/lib/dates";

const FLASH: Record<string, { tone: "ok" | "bad"; text: string }> = {
  sent: { tone: "ok", text: "Invite sent. The link works for 14 days." },
  email_failed: { tone: "bad", text: "The invite is saved, but the email didn't go out. Cancel it and try again." },
  cancelled: { tone: "ok", text: "Invite cancelled. That link no longer works." },
  removed: { tone: "ok", text: "Done. They can't sign in to this account now." },
  bad_email: { tone: "bad", text: "That email doesn't look right." },
  bad_role: { tone: "bad", text: "Pick a role from the list." },
  no_seats: { tone: "bad", text: "No seats left. Free a seat first." },
  already_member: { tone: "bad", text: "That person is already on your team." },
  forbidden: { tone: "bad", text: "Only the owner can change the team." },
  remove_self: { tone: "bad", text: "You can't remove yourself." },
  remove_owner: { tone: "bad", text: "An owner can't be taken off the team here." },
  remove_not_found: { tone: "bad", text: "That person is no longer on the team." },
  not_configured: { tone: "bad", text: "Something went wrong. Please try again." },
  error: { tone: "bad", text: "Something went wrong. Please try again." },
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: DEFAULT_TIME_ZONE, month: "short", day: "numeric", year: "numeric" });
}

export async function TeamSection({
  orgId,
  plan,
  callerUserId,
  canManage,
  flash,
}: {
  orgId: string;
  plan: string | null;
  callerUserId: string | null;
  canManage: boolean;
  flash?: string;
}) {
  const team = await loadTeam(orgId);
  const note = flash ? FLASH[flash] : undefined;
  const limit = teammateLimit(plan);
  const left = team
    ? seatsLeft({ plan, memberCount: team.members.length, pendingInviteCount: team.invites.length })
    : 0;

  return (
    <div className="mt-6 space-y-6">
      {note && (
        <div
          className={
            note.tone === "ok"
              ? "rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
              : "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          }
        >
          {note.text}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex items-center gap-2.5">
          <IconTile size="sm"><Icons.users className="h-4 w-4" /></IconTile>
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Your team</h3>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          People who can sign in to this account. Each person signs in with their own email.
        </p>

        {!team ? (
          <p className="mt-4 text-sm text-gray-500">The team list can't load right now.</p>
        ) : (
          <ul className="mt-4 divide-y divide-gray-100">
            {team.members.map((m) => (
              <li key={m.membershipId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {m.email ?? "Unknown email"}
                    {m.userId === callerUserId && <span className="ml-2 text-xs text-gray-400">· you</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {teamRoleLabel(m.role)} · joined {day(m.joinedAt)}
                  </p>
                </div>
                {canManage && m.role !== "owner_admin" && m.userId !== callerUserId && (
                  <form action={removeTeammate}>
                    <input type="hidden" name="membership_id" value={m.membershipId} />
                    <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
            {team.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{i.email}</p>
                  <p className="text-xs text-gray-500">
                    {teamRoleLabel(i.role)} · invited {day(i.createdAt)} · waiting to join
                  </p>
                </div>
                {canManage && (
                  <form action={cancelTeamInvite}>
                    <input type="hidden" name="invite_id" value={i.id} />
                    <button className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                      Cancel invite
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Add a teammate</h3>
          {limit === 0 ? (
            <p className="mt-2 text-sm text-gray-600">
              Teammates come with Starter and up. Right now only you can sign in.{" "}
              <Link href="/dashboard/billing" className="font-medium text-brand underline">
                See Growth
              </Link>
            </p>
          ) : left === 0 ? (
            <p className="mt-2 text-sm text-gray-600">
              All {limit} teammate seats are in use. Remove someone or cancel an invite to add another.
            </p>
          ) : (
            <form action={inviteTeammate} className="mt-3 space-y-3">
              <p className="text-sm text-gray-500">
                We email them a link. They sign in with their own email. {left} of {limit} seats left.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="flex-1">
                  <span className="sr-only">Their email</span>
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="Their email"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label>
                  <span className="sr-only">Role</span>
                  <select name="role" defaultValue="operator" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                    {INVITABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {teamRoleLabel(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
                  Send invite
                </button>
              </div>
              <p className="text-xs text-gray-500">{teamRoleBlurb("operator")}</p>
            </form>
          )}
        </div>
      )}

      {canManage && (
        <div id="viewing-helper" className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Add a viewing helper</h3>
          <p className="mt-2 text-sm text-gray-600">
            Someone who only shows rentals doesn&apos;t need a sign-in. Add them as a showing agent.
          </p>
          <p className="mt-1 text-sm text-gray-600">
            They get a private page with only their viewings. It shows the renter, the time and how to get in.
            They confirm with one tap. Your rent, expenses and tenants stay hidden.
          </p>
          <Link
            href="/dashboard/showing-agents"
            className="mt-3 inline-block rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            Add a showing agent
          </Link>
        </div>
      )}
    </div>
  );
}
