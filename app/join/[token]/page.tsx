// S744 (roadmap item 14): the page a team invite email links to. Public, so a
// person without a login can see what they were invited to before signing up.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth-shell";
import { inviteByToken } from "@/lib/team-server";
import { ACCEPT_MESSAGES, checkAccept, teamRoleBlurb, teamRoleLabel, type AcceptCheck } from "@/lib/team";
import { acceptInviteByToken } from "../actions";

export const dynamic = "force-dynamic";

type Reason = Exclude<AcceptCheck, { ok: true }>["reason"];
const REASONS = Object.keys(ACCEPT_MESSAGES) as Reason[];

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { e?: string };
}) {
  const token = params.token;
  const invite = await inviteByToken(token);
  const here = `/join/${encodeURIComponent(token)}`;
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const errorFromAction = REASONS.includes(searchParams.e as Reason)
    ? ACCEPT_MESSAGES[searchParams.e as Reason]
    : searchParams.e
      ? "Something went wrong. Please try again."
      : null;

  if (!invite) {
    return (
      <AuthShell title="This invite link doesn't work">
        <p className="text-sm text-gray-600">{ACCEPT_MESSAGES.not_found}</p>
      </AuthShell>
    );
  }

  // Check everything but the email first, so a signed-out person sees a dead
  // link as dead before being asked to log in.
  const linkCheck = checkAccept({
    invite,
    userEmail: invite.invited_email,
    emailConfirmed: true,
    memberOrgIds: [],
    now: new Date(),
  });
  if (!linkCheck.ok) {
    return (
      <AuthShell title="This invite can't be used">
        <p className="text-sm text-gray-600">{ACCEPT_MESSAGES[linkCheck.reason]}</p>
        {linkCheck.reason === "used" && (
          <Link href="/login" className="mt-4 inline-block text-sm font-medium text-brand underline">
            Log in
          </Link>
        )}
      </AuthShell>
    );
  }

  const title = `Join ${invite.org_name}`;
  const subtitle = `You're invited as a ${teamRoleLabel(invite.role).toLowerCase()}. ${teamRoleBlurb(invite.role)}`;

  if (!user) {
    return (
      <AuthShell eyebrow="Team invite" title={title} subtitle={subtitle}>
        <p className="text-sm text-gray-600">
          Use <strong>{invite.invited_email}</strong> to log in or create your login.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(here)}`}
            className="rounded-lg bg-brand px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
          >
            I have a login
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(here)}`}
            className="rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            Create my login
          </Link>
        </div>
      </AuthShell>
    );
  }

  const check = checkAccept({
    invite,
    userEmail: user.email,
    emailConfirmed: user.email_confirmed_at != null,
    memberOrgIds: [],
    now: new Date(),
  });

  if (!check.ok && check.reason === "wrong_email") {
    return (
      <AuthShell eyebrow="Team invite" title={title} subtitle={subtitle}>
        <p className="text-sm text-gray-600">
          You're logged in as <strong>{user.email}</strong>. This invite is for{" "}
          <strong>{invite.invited_email}</strong>.
        </p>
        <p className="mt-2 text-sm text-gray-600">Log out, then open the invite link again.</p>
        <form action="/auth/signout" method="post" className="mt-5">
          <button className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50">
            Log out
          </button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Team invite" title={title} subtitle={subtitle}>
      {errorFromAction && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {errorFromAction}
        </div>
      )}
      {!check.ok ? (
        <p className="text-sm text-gray-600">{ACCEPT_MESSAGES[check.reason]}</p>
      ) : (
        <form action={acceptInviteByToken}>
          <input type="hidden" name="token" value={token} />
          <p className="text-sm text-gray-600">
            You'll join as <strong>{user.email}</strong>.
          </p>
          <button className="mt-5 w-full rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90">
            Join {invite.org_name}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
