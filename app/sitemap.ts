import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import {
  buildSitemapEntries,
} from "@/lib/listing-seo";
import type { BrowseProvider } from "@/lib/browse-surface";

export const revalidate = 900;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

// S728: the public marketing pages, always listed. The browse surface's
// listing pages follow when it is on.
const WWW = "https://www.vacantless.com";
const MARKETING_PAGES: MetadataRoute.Sitemap = [
  { url: `${WWW}/`, changeFrequency: "weekly", priority: 1 },
  { url: `${WWW}/realtors`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${WWW}/compare/showinghero`, changeFrequency: "monthly", priority: 0.8 },
  { url: `${WWW}/how-to`, changeFrequency: "monthly", priority: 0.7 },
  { url: `${WWW}/about`, changeFrequency: "monthly", priority: 0.5 },
  { url: `${WWW}/privacy`, changeFrequency: "yearly", priority: 0.2 },
  { url: `${WWW}/terms`, changeFrequency: "yearly", priority: 0.2 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.BROWSE_SURFACE_ENABLED !== "true") return MARKETING_PAGES;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return MARKETING_PAGES;

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("get_public_browse_listings");
  if (error || !Array.isArray(data)) return MARKETING_PAGES;

  return [
    ...MARKETING_PAGES,
    ...buildSitemapEntries(data as BrowseProvider[], { baseUrl: APP_URL }).map((entry) => ({ url: entry.url })),
  ];
}
