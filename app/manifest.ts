import type { MetadataRoute } from "next";

// S802 (REVIEW-S799 item 10): "Add to home screen" opens Vacantless like an
// app (no browser bar) straight into the dashboard. Icons are the gradient
// app icon from vacantless-brand-assets/app-icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vacantless",
    short_name: "Vacantless",
    description: "Rental leasing software for landlords and property managers.",
    id: "/dashboard",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#176044",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
