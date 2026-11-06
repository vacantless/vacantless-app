import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

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
  // S751 (Fable review, lower list): basic security headers on every response.
  // No page is meant to be framed by another site (the app frames only its own
  // pages and signed document links), so framing is same-origin only. No full
  // script CSP yet: it would need a nonce pass over every inline script first.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // S728: the nav says Plans -> /#pricing, but people type /pricing and ads
  // link it. Both short paths were 404s.
  async redirects() {
    return [
      { source: "/pricing", destination: "/#pricing", permanent: true },
      { source: "/plans", destination: "/#pricing", permanent: true },
      { source: "/features", destination: "/#product", permanent: true },
      { source: "/compare", destination: "/compare/showinghero", permanent: true },
      { source: "/videos", destination: "/how-to", permanent: true },
    ];
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
      // S748g: the LTB's 2026 forms (the old ones are refused after 2026-11-30).
      "/notice/[token]/official": ["./lib/forms/ltb-n4-2026-09.pdf"],
      // S755: the free public N4 tool.
      "/tools/n4/official": ["./lib/forms/ltb-n4-2026-09.pdf"],
      "/dashboard/tenancies/[id]/n4/official": ["./lib/forms/ltb-n4-2026-09.pdf"],
      "/dashboard/tenancies/[id]/n12/official": ["./lib/forms/ltb-n12-2026-10.pdf"],
      "/dashboard/tenancies/[id]/n13/official": ["./lib/forms/ltb-n13-2026.pdf"],
      "/dashboard/tenancies/[id]/l1/official": ["./lib/forms/ltb-l1-2026.pdf"],
      "/dashboard/tenancies/[id]/l9/official": ["./lib/forms/ltb-l9-2026.pdf"],
      "/dashboard/tenancies/[id]/l10/official": ["./lib/forms/ltb-l10-2026.pdf"],
      "/dashboard/tenancies/[id]/n5/official": ["./lib/forms/ltb-n5-2026.pdf"],
      "/dashboard/tenancies/[id]/n6/official": ["./lib/forms/ltb-n6-2026.pdf"],
      "/dashboard/tenancies/[id]/l2/official": ["./lib/forms/ltb-l2-2026.pdf"],
      "/dashboard/tenancies/[id]/n8/official": ["./lib/forms/ltb-n8-2026.pdf"],
      // The N4 "file to vault" server action runs in the tenancy page itself.
      "/dashboard/tenancies/[id]": ["./lib/forms/ltb-n4-2026-09.pdf", "./lib/forms/ltb-n12-2026-10.pdf"],
      // S743: Ontario Standard Form of Lease (2229E) flat copy.
      "/dashboard/tenancies/[id]/lease/[leaseId]/standard/pdf": ["./lib/forms/ontario-2229e-2020-12-flat.pdf"],
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

export default withNextIntl(nextConfig);
