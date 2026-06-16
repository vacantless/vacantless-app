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
};

export default nextConfig;
