// S784: which page URLs may reach Vercel Web Analytics (pure, tested in
// scripts/test-site-analytics.ts). Marketing pages only; only utm_ tags kept.
import { isMarketingPath } from "./ad-conversions";

export function keepAnalyticsUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!isMarketingPath(u.pathname)) return null;
  const keep = new URLSearchParams();
  u.searchParams.forEach((v, k) => {
    if (k.startsWith("utm_")) keep.set(k, v);
  });
  const q = keep.toString();
  return `${u.origin}${u.pathname}${q ? `?${q}` : ""}`;
}
