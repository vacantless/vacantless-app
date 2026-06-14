// ============================================================================
// Tenant-isolation RLS verification — the M1 acceptance gate.
//
// Creates two orgs (A and B) owned by two different users, each with a
// property, then proves that each user's session can ONLY read its own org's
// rows. If org A can see any of org B's rows, RLS is broken and this exits 1.
//
// Run:  node --env-file=.env.local scripts/verify-rls.mjs
// Needs: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
//        SUPABASE_SERVICE_ROLE_KEY  (all in .env.local)
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error(
    "Missing env. Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY in .env.local",
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const fail = (msg) => {
  console.error("\n❌ FAIL:", msg);
  process.exit(1);
};

async function makeUser(tag) {
  const email = `rls-test-${tag}-${stamp}@example.com`;
  const password = `Test-${stamp}-${tag}!`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) fail(`createUser ${tag}: ${error.message}`);
  return { email, password, id: data.user.id };
}

// A fresh anon client signed in as a specific user.
async function sessionFor(user) {
  const c = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) fail(`signIn ${user.email}: ${error.message}`);
  return c;
}

async function main() {
  console.log("Creating two users…");
  const userA = await makeUser("a");
  const userB = await makeUser("b");

  const a = await sessionFor(userA);
  const b = await sessionFor(userB);

  console.log("Creating one org + one property per user…");
  const { data: orgA, error: eA } = await a
    .rpc("create_organization", { p_name: "Org A", p_slug: `org-a-${stamp}` })
    .single();
  if (eA) fail(`create_organization A: ${eA.message}`);

  const { data: orgB, error: eB } = await b
    .rpc("create_organization", { p_name: "Org B", p_slug: `org-b-${stamp}` })
    .single();
  if (eB) fail(`create_organization B: ${eB.message}`);

  await a.from("properties").insert({
    organization_id: orgA.id,
    address: "1 A Street",
  });
  await b.from("properties").insert({
    organization_id: orgB.id,
    address: "1 B Street",
  });

  console.log("\nRunning isolation checks…");

  // 1. A sees exactly its own org.
  const { data: aOrgs } = await a.from("organizations").select("id, name");
  if (aOrgs?.length !== 1 || aOrgs[0].id !== orgA.id)
    fail(`User A should see only Org A, saw: ${JSON.stringify(aOrgs)}`);
  console.log("  ✓ User A sees only Org A");

  // 2. B sees exactly its own org.
  const { data: bOrgs } = await b.from("organizations").select("id, name");
  if (bOrgs?.length !== 1 || bOrgs[0].id !== orgB.id)
    fail(`User B should see only Org B, saw: ${JSON.stringify(bOrgs)}`);
  console.log("  ✓ User B sees only Org B");

  // 3. A's property list excludes B's properties.
  const { data: aProps } = await a.from("properties").select("address");
  const aAddrs = (aProps ?? []).map((p) => p.address);
  if (aAddrs.includes("1 B Street"))
    fail("User A can see Org B's property — RLS leak!");
  if (!aAddrs.includes("1 A Street"))
    fail("User A cannot see its own property");
  console.log("  ✓ User A's properties exclude Org B's");

  // 4. A explicitly targeting B's org id returns nothing.
  const { data: targeted } = await a
    .from("organizations")
    .select("id")
    .eq("id", orgB.id);
  if (targeted && targeted.length > 0)
    fail("User A can directly query Org B by id — RLS leak!");
  console.log("  ✓ User A cannot fetch Org B even by explicit id");

  // 5. A cannot insert a property into B's org (WITH CHECK).
  const { error: crossInsert } = await a
    .from("properties")
    .insert({ organization_id: orgB.id, address: "evil" });
  if (!crossInsert)
    fail("User A was able to insert into Org B — RLS WITH CHECK leak!");
  console.log("  ✓ User A cannot write into Org B");

  console.log("\n✅ PASS — tenant isolation holds across all checks.");
  console.log(
    "Cleanup: the test users/orgs remain in the DB; delete via Supabase dashboard if desired.",
  );
}

main().catch((e) => fail(e.message));
