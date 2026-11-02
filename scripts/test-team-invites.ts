// S744 (roadmap item 14): team invites. Run: npx tsx scripts/test-team-invites.ts
import { readFileSync } from "node:fs";
import {
  ACCEPT_MESSAGES,
  INVITABLE_ROLES,
  checkAccept,
  hashInviteToken,
  inviteExpiresAt,
  isEmailShaped,
  newInviteToken,
  normalizeEmail,
  seatsLeft,
  teammateLimit,
  teamRoleLabel,
} from "../lib/team";
import { roleForActiveOrg } from "../lib/membership";
import { roleCan } from "../lib/roles";
import { safeNextPath } from "../lib/safe-next";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- Seats ------------------------------------------------------------------
ok("free has no teammates", teammateLimit("free") === 0);
ok("unknown plan has no teammates", teammateLimit("gold") === 0 && teammateLimit(null) === 0);
ok("growth has 2 teammates", teammateLimit("growth") === 2);
ok("premium has 5 teammates", teammateLimit("premium") === 5);
ok("growth owner alone: 2 left", seatsLeft({ plan: "growth", memberCount: 1, pendingInviteCount: 0 }) === 2);
ok("growth owner + 1 member: 1 left", seatsLeft({ plan: "growth", memberCount: 2, pendingInviteCount: 0 }) === 1);
ok("open invites use seats", seatsLeft({ plan: "growth", memberCount: 2, pendingInviteCount: 1 }) === 0);
ok("never negative", seatsLeft({ plan: "growth", memberCount: 5, pendingInviteCount: 3 }) === 0);
ok("free owner: 0 left", seatsLeft({ plan: "free", memberCount: 1, pendingInviteCount: 0 }) === 0);

// --- Emails and tokens ------------------------------------------------------
ok("normalizeEmail trims and lowercases", normalizeEmail("  Pat@Example.COM ") === "pat@example.com");
ok("email shape ok", isEmailShaped("pat@example.com"));
ok("email shape rejects junk", !isEmailShaped("pat@") && !isEmailShaped("") && !isEmailShaped("a b@c.d"));
const t1 = newInviteToken();
const t2 = newInviteToken();
ok("tokens are long", t1.length >= 32);
ok("tokens differ", t1 !== t2);
ok("tokens are url-safe", /^[A-Za-z0-9_-]+$/.test(t1));
ok("hash is stable", hashInviteToken(t1) === hashInviteToken(t1));
ok("hash is not the token", hashInviteToken(t1) !== t1 && hashInviteToken(t1).length === 64);
const now = new Date("2026-11-02T12:00:00Z");
ok("expires in 14 days", inviteExpiresAt(now).toISOString() === "2026-11-16T12:00:00.000Z");

// --- Accept rules -----------------------------------------------------------
const inv = {
  status: "pending",
  expires_at: "2026-11-10T00:00:00Z",
  invited_email: "Pat@Example.com",
  organization_id: "org-a",
};
const base = { invite: inv, userEmail: "pat@example.com", emailConfirmed: true, memberOrgIds: [] as string[], now };
ok("good invite accepts", checkAccept(base).ok);
ok("email match ignores case", checkAccept({ ...base, userEmail: "PAT@EXAMPLE.COM" }).ok);
const r = (x: ReturnType<typeof checkAccept>) => (x.ok ? "ok" : x.reason);
ok("missing invite", r(checkAccept({ ...base, invite: null })) === "not_found");
ok("used invite", r(checkAccept({ ...base, invite: { ...inv, status: "accepted" } })) === "used");
ok("cancelled invite", r(checkAccept({ ...base, invite: { ...inv, status: "revoked" } })) === "revoked");
ok("odd status", r(checkAccept({ ...base, invite: { ...inv, status: "weird" } })) === "not_found");
ok("expired invite", r(checkAccept({ ...base, now: new Date("2026-11-11T00:00:00Z") })) === "expired");
ok("wrong email", r(checkAccept({ ...base, userEmail: "someone@else.com" })) === "wrong_email");
ok("unconfirmed email never accepts", r(checkAccept({ ...base, emailConfirmed: false })) === "email_not_confirmed");
ok("already on the team", r(checkAccept({ ...base, memberOrgIds: ["org-a"] })) === "already_member");
ok("member of another org can still join", checkAccept({ ...base, memberOrgIds: ["org-b"] }).ok);
ok("every refusal has a message", Object.values(ACCEPT_MESSAGES).every((m) => m.length > 0 && !m.includes("—")));

// --- Roles ------------------------------------------------------------------
ok("slice 1 invites teammates only", INVITABLE_ROLES.length === 1 && INVITABLE_ROLES[0] === "operator");
ok("owner manages the team", roleCan("owner_admin", "manage_team"));
ok("teammate cannot manage the team", !roleCan("operator", "manage_team"));
ok("labels", teamRoleLabel("owner_admin") === "Owner" && teamRoleLabel("operator") === "Teammate");

// The role used for guards is the one in the ACTIVE account (the S744 bug:
// it used to be the first membership, whatever the account).
const rows = [
  { organization_id: "own", role: "owner_admin" },
  { organization_id: "agile", role: "operator" },
];
ok("active account role wins", roleForActiveOrg(rows, "agile") === "operator");
ok("own account role", roleForActiveOrg(rows, "own") === "owner_admin");
ok("forged cookie falls back to first", roleForActiveOrg(rows, "other") === "owner_admin");
ok("no memberships is null", roleForActiveOrg([], "agile") === null);

// --- Return paths -----------------------------------------------------------
ok("login can return to a join link", safeNextPath("/join/abc123") === "/join/abc123");
ok("still blocks other sites", safeNextPath("//evil.com/join") === "/dashboard");

// --- Source checks ----------------------------------------------------------
const mig = readFileSync("supabase/migrations/0265_team_invites.sql", "utf8");
ok("invites table has RLS on", /alter table public\.team_invites enable row level security/.test(mig));
ok("invites hidden from browser roles", /revoke all on public\.team_invites from anon, authenticated/.test(mig));
ok("only the token hash is stored", /token_hash\s+text not null unique/.test(mig) && !/\btoken\s+text/.test(mig));
const actions = readFileSync("app/dashboard/settings/team-actions.ts", "utf8");
const guarded = actions.split("export async function").slice(1);
ok("every team action checks manage_team first", guarded.length === 3 && guarded.every((f) => f.split("\n").slice(0, 3).join("\n").includes('requireCapability("manage_team"')));
const server = readFileSync("lib/team-server.ts", "utf8");
ok("accept runs checkAccept before writing", server.indexOf("checkAccept(") < server.indexOf('.from("memberships").insert'));
const join = readFileSync("app/join/actions.ts", "utf8");
ok("accept passes email_confirmed_at", join.includes("email_confirmed_at != null"));

const billing = readFileSync("app/dashboard/billing/page.tsx", "utf8");
ok("billing tells a teammate only the owner can change it (S744b)", billing.includes('roleCan(billingRole, "manage_billing")') && billing.includes("Only the account owner can change the plan or billing."));

console.log(`team invites: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
