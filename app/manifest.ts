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
    // S821b: on Android the installed app shows in the Share menu. A chat
    // screenshot shared to it saves the renter (app/dashboard/replies/shared).
    // No Shortcut and no key: the landlord's own sign-in is the key.
    // Next's manifest type has the wrong shape for share_target (no "files"),
    // so it is cast; the JSON is the W3C Web Share Target shape Chrome reads.
    share_target: {
      action: "/dashboard/replies/shared",
      method: "POST",
      enctype: "multipart/form-data",
      params: { files: [{ name: "screenshot", accept: ["image/png", "image/jpeg", "image/webp"] }] },
    } as unknown as MetadataRoute.Manifest["share_target"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
