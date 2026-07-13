/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ESLint is wired (next lint + eslint-config-next) as a manual/CI hygiene tool,
  // but it must NOT gate the production build: `tsc --noEmit` is the enforced
  // correctness gate, and Next runs eslint during `next build` and fails the
  // build on lint errors by default. Keeping lint out of the build means a future
  // lint regression can never break a Vercel deploy. Run `npm run lint` to check.
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Photo uploads ride a server action as multipart FormData. The default
    // body cap is 1 MB — far too small for phone photos — so raise it. Each
    // file is still validated at 10 MB (lib/photos.ts MAX_PHOTO_BYTES); this
    // headroom lets a few photos upload in one submit.
    serverActions: {
      bodySizeLimit: "30mb",
    },
    // Bundle the LTB N1 template into the official-N1 route's serverless function
    // (fs.readFileSync at runtime needs it traced; else the route 500s in prod).
    outputFileTracingIncludes: {
      "/n1/[token]/official": ["./lib/forms/ltb-n1-2022.pdf"],
      "/notice/[token]/official": ["./lib/forms/ltb-n4-2022.pdf"],
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
