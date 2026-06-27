// Unit tests for the pure referral-loop logic (S355, Slice 2).
// Run: npx tsx scripts/test-referrals.ts
import {
  parseRefToken,
  validateReferralFriend,
  buildReferralLink,
  canAcceptReferral,
  referralStatusLabel,
  shapeReferralRow,
  shapeReferralRows,
  referralCounts,
  type ReferralRow,
  type AcceptCandidateRow,
} from "../lib/referrals";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- parseRefToken ---------------------------------------------------------
ok("valid base64url token passes", parseRefToken("abcDEF123_-xyzABC456") === "abcDEF123_-xyzABC456");
ok("trims surrounding whitespace", parseRefToken("  abcDEF123_-xyzABC  ") === "abcDEF123_-xyzABC");
ok("too short -> null", parseRefToken("short") === null);
ok("too long -> null", parseRefToken("a".repeat(65)) === null);
ok("illegal chars -> null", parseRefToken("abc!def$ghi%jkl^mno") === null);
ok("plus/slash (non-url base64) -> null", parseRefToken("abcd+efgh/ijkl=mnop") === null);
ok("null -> null", parseRefToken(null) === null);
ok("empty -> null", parseRefToken("") === null);
ok("exactly 16 chars passes", parseRefToken("abcdef0123456789") === "abcdef0123456789");

// --- validateReferralFriend ------------------------------------------------
ok("empty input ok (no details)", (() => {
  const r = validateReferralFriend({});
  return r.ok && r.value.email === null && r.value.name === null;
})());
ok("name-only ok", (() => {
  const r = validateReferralFriend({ name: "  Zak  Smith " });
  return r.ok && r.value.name === "Zak Smith" && r.value.email === null;
})());
ok("valid email normalized", (() => {
  const r = validateReferralFriend({ email: " Zak@Gmail.COM " });
  return r.ok && r.value.email === "zak@gmail.com";
})());
ok("bad email rejected", validateReferralFriend({ email: "not-an-email" }).ok === false);
ok("over-long name rejected", validateReferralFriend({ name: "x".repeat(121) }).ok === false);

// --- buildReferralLink -----------------------------------------------------
ok(
  "builds signup link with ref",
  buildReferralLink("https://app.vacantless.com", "tok123") ===
    "https://app.vacantless.com/signup?ref=tok123",
);
ok(
  "trims trailing slash on origin",
  buildReferralLink("https://app.vacantless.com/", "tok123") ===
    "https://app.vacantless.com/signup?ref=tok123",
);

// --- canAcceptReferral -----------------------------------------------------
const pendingRow: AcceptCandidateRow = {
  status: "pending",
  source: "referral",
  referred_by_org_id: "org-referrer",
};
ok("accepts a pending referral for a different org", canAcceptReferral(pendingRow, "org-new").accept === true);
ok("no newOrgId -> skip(no_token)", (() => {
  const d = canAcceptReferral(pendingRow, null);
  return d.accept === false && d.reason === "no_token";
})());
ok("null row -> skip(not_found)", (() => {
  const d = canAcceptReferral(null, "org-new");
  return d.accept === false && d.reason === "not_found";
})());
ok("already accepted -> skip(not_pending)", (() => {
  const d = canAcceptReferral({ status: "accepted", source: "referral", referred_by_org_id: "x" }, "org-new");
  return d.accept === false && d.reason === "not_pending";
})());
ok("operator-source row -> skip(not_referral)", (() => {
  const d = canAcceptReferral({ status: "pending", source: "operator", referred_by_org_id: "x" }, "org-new");
  return d.accept === false && d.reason === "not_referral";
})());
ok("self-referral -> skip(self_referral)", (() => {
  const d = canAcceptReferral({ status: "pending", source: "referral", referred_by_org_id: "org-new" }, "org-new");
  return d.accept === false && d.reason === "self_referral";
})());

// --- referralStatusLabel ---------------------------------------------------
ok("pending -> Invited", referralStatusLabel("pending") === "Invited");
ok("accepted -> Joined", referralStatusLabel("accepted") === "Joined");
ok("unknown -> dash", referralStatusLabel("nonsense") === "—");

// --- shapeReferralRow ------------------------------------------------------
const rowName: ReferralRow = {
  id: "1",
  created_at: "2026-06-27T10:00:00Z",
  invited_email: "zak@gmail.com",
  invited_name: "Zak Smith",
  status: "pending",
  token: "tok1",
  accepted_at: null,
};
ok("prefers name as label", shapeReferralRow(rowName).label === "Zak Smith");
ok("pending flagged", shapeReferralRow(rowName).isPending === true && shapeReferralRow(rowName).isAccepted === false);
ok("falls back to email when no name", (() => {
  const v = shapeReferralRow({ ...rowName, invited_name: null });
  return v.label === "zak@gmail.com";
})());
ok("falls back to placeholder when nothing", (() => {
  const v = shapeReferralRow({ ...rowName, invited_name: null, invited_email: null });
  return v.label === "Invited landlord";
})());
ok("accepted flagged", (() => {
  const v = shapeReferralRow({ ...rowName, status: "accepted", accepted_at: "2026-06-28T00:00:00Z" });
  return v.isAccepted === true && v.isPending === false && v.statusLabel === "Joined";
})());

// --- shapeReferralRows (sort) ----------------------------------------------
ok("sorts newest first", (() => {
  const rows: ReferralRow[] = [
    { ...rowName, id: "old", created_at: "2026-06-01T00:00:00Z" },
    { ...rowName, id: "new", created_at: "2026-06-27T00:00:00Z" },
  ];
  const out = shapeReferralRows(rows);
  return out[0].id === "new" && out[1].id === "old";
})());

// --- referralCounts --------------------------------------------------------
ok("counts joined/pending/total", (() => {
  const rows: ReferralRow[] = [
    { ...rowName, id: "a", status: "pending" },
    { ...rowName, id: "b", status: "accepted" },
    { ...rowName, id: "c", status: "accepted" },
    { ...rowName, id: "d", status: "revoked" },
  ];
  const c = referralCounts(rows);
  return c.total === 4 && c.joined === 2 && c.pending === 1;
})());

// --- summary ---------------------------------------------------------------
console.log(`\nreferrals: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
