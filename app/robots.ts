import type { MetadataRoute } from "next";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

export default function robots(): MetadataRoute.Robots {
  const rules = {
    userAgent: "*",
    allow: "/",
    disallow: ["/dashboard", "/api"],
  };

  if (process.env.BROWSE_SURFACE_ENABLED !== "true") {
    return { rules };
  }

  return {
    rules,
    sitemap: `${APP_URL.replace(/\/+$/g, "")}/sitemap.xml`,
  };
}
