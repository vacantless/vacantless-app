/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Photo uploads ride a server action as multipart FormData. The default
    // body cap is 1 MB — far too small for phone photos — so raise it. Each
    // file is still validated at 10 MB (lib/photos.ts MAX_PHOTO_BYTES); this
    // headroom lets a few photos upload in one submit.
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
  webpack: (config) => {
    // pdf.js (client-side MLS data-sheet import, S292) references the Node-only
    // optional `canvas` package on its server path; the browser build never
    // needs it. Alias it to false so webpack doesn't try to bundle/resolve it
    // (the standard Next.js + pdf.js fix) — keeps the client build clean.
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
