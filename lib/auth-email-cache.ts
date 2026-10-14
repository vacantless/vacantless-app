// S717: background sweeps looked up each team member's email with one
// auth.admin.getUserById call per member, per org, one after another. At 12
// orgs distribution-freshness already took ~10 s of its 50 s budget, and the
// cost grows with every landlord. This loads every login once per admin client
// (one call per 1,000 users) and answers each lookup from memory. A user the
// page did not include (created mid-run) falls back to the single lookup.
//
// The returned shape matches getUserById's, so callers keep `u?.user?.email`.

type AdminLike = {
  auth: {
    admin: {
      listUsers: (p: { page: number; perPage: number }) => Promise<{
        data: { users: { id: string; email?: string | null }[] } | null;
        error: unknown;
      }>;
      getUserById: (id: string) => Promise<{ data: { user: { id: string; email?: string | null } | null } | null }>;
    };
  };
};

const PER_PAGE = 1000;
const MAX_PAGES = 100;
const cache = new WeakMap<object, Promise<Map<string, string | null>>>();

async function loadAll(admin: AdminLike): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error || !data) break;
    for (const u of data.users) map.set(u.id, u.email ?? null);
    if (data.users.length < PER_PAGE) break;
  }
  return map;
}

/** Drop-in for admin.auth.admin.getUserById(id) when only the email is read. */
export async function getUserByIdCached(
  admin: unknown,
  userId: string,
): Promise<{ data: { user: { id: string; email: string | null } | null } }> {
  const a = admin as AdminLike;
  let p = cache.get(a);
  if (!p) {
    p = loadAll(a).catch(() => new Map<string, string | null>());
    cache.set(a, p);
  }
  const map = await p;
  if (map.has(userId)) return { data: { user: { id: userId, email: map.get(userId) ?? null } } };
  const { data } = await a.auth.admin.getUserById(userId);
  const email = data?.user?.email ?? null;
  map.set(userId, email);
  return { data: { user: data?.user ? { id: userId, email } : null } };
}
