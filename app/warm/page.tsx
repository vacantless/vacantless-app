// S841c: Vercel's cron opens this page every 5 minutes (vercel.json) so the
// server copy the dashboard uses stays awake. It is not indexed.
// S841f: the boot marks (ff61d85) showed the copy WAS awake and shared with
// the dashboard, yet the first dashboard load after 16 idle minutes still
// took 3.25 s (1.4 s before the page even started, against 0.3 s). What had
// gone cold was the path to the database, which this page never touched. It
// now asks the database and the sign-in service one tiny question each, and
// logs how long each took, so the next read shows whether that keeps the
// path warm. It returns nothing it reads.
import type { Metadata } from "next";
import { bootMark } from "@/lib/boot-mark";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

async function timed(work: () => PromiseLike<unknown>): Promise<number> {
  const t = Date.now();
  try {
    await work();
  } catch {
    return -1;
  }
  return Date.now() - t;
}

export default async function WarmPage() {
  const admin = createAdminClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const [db, auth] = await Promise.all([
    admin ? timed(() => admin.from("organizations").select("id", { count: "exact", head: true }).limit(1)) : -1,
    url && key ? timed(() => fetch(`${url}/auth/v1/health`, { headers: { apikey: key }, cache: "no-store" })) : -1,
  ]);
  console.log(`${bootMark("warm")} db=${db} auth=${auth}`);
  return <p>ok</p>;
}
