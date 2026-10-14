import assert from "node:assert/strict";
import { getUserByIdCached } from "../lib/auth-email-cache";

let listCalls = 0;
let singleCalls = 0;
const users = Array.from({ length: 1500 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.ca` }));
const admin = {
  auth: {
    admin: {
      listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
        listCalls++;
        return { data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null };
      },
      getUserById: async (id: string) => {
        singleCalls++;
        return { data: { user: id === "late" ? { id, email: "late@x.ca" } : null } };
      },
    },
  },
};

async function main() {
  for (const id of ["u0", "u999", "u1000", "u1499", "u5"]) {
    const { data } = await getUserByIdCached(admin, id);
    assert.equal(data.user?.email, `${id}@x.ca`);
  }
  assert.equal(listCalls, 2, "1,500 users load in two pages, once");
  assert.equal(singleCalls, 0);
  assert.equal((await getUserByIdCached(admin, "late")).data.user?.email, "late@x.ca");
  assert.equal((await getUserByIdCached(admin, "gone")).data.user, null);
  assert.equal(singleCalls, 2, "only unknown ids fall back to the single lookup");
  // A new admin client (a new request) loads fresh.
  const admin2 = { auth: { admin: { ...admin.auth.admin } } };
  await getUserByIdCached(admin2, "u1");
  assert.equal(listCalls, 4);
  console.log("auth-email-cache: all checks passed");
}
main();
