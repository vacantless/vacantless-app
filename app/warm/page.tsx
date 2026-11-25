// S841c: Vercel's metrics showed 45.5% of server calls in 12 hours were cold
// starts (a fresh copy of the server waking up), which is why the first page a
// landlord opens after a quiet spell took 2.4 to 3.0 s. A public rental page
// opened after 12 idle minutes woke the same copy the dashboard uses, so
// Vercel's cron opens this tiny page every 5 minutes (vercel.json) to keep one
// copy awake. It reads nothing and is not indexed.
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function WarmPage() {
  return <p>ok</p>;
}
