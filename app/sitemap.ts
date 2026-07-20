import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import {
  buildSitemapEntries,
} from "@/lib/listing-seo";
import type { BrowseProvider } from "@/lib/browse-surface";

export const revalidate = 900;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.BROWSE_SURFACE_ENABLED !== "true") return [];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return [];

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.rpc("get_public_browse_listings");
  if (error || !Array.isArray(data)) return [];

  return buildSitemapEntries(data as BrowseProvider[], {
    baseUrl: APP_URL,
  }).map((entry) => ({ url: entry.url }));
}
