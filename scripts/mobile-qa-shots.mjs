#!/usr/bin/env node
/**
 * mobile-qa-shots.mjs — ESL nav-audit mobile acceptance-gate screenshot harness.
 *
 * WHY THIS EXISTS (S604 blocker → S605 fix):
 *   The ESL/older-operator nav audit's Slice 9 redesigns must be verified at the two
 *   iPhone breakpoints 390x844 and 430x932. Driving the desktop Chrome window below its
 *   OS min-width does NOT shrink the rendered viewport (innerWidth stays ~1920), so real
 *   mobile-layout screenshots could not be captured that way. Headless Chromium honours an
 *   exact emulated viewport with no min-width floor — this harness captures pixel-perfect
 *   390x844@3x (1170x2532) and 430x932@3x (1290x2796) shots of any set of routes.
 *
 * RUN (locally, against a dev server — no prod network needed):
 *   npm i -D playwright && npx playwright install chromium      # one-time, dev-only (not committed to deps)
 *   npm run dev                                                 # serves http://localhost:3000
 *   BASE_URL=http://localhost:3000 STORAGE_STATE=./vacantless-session.json \
 *     node scripts/mobile-qa-shots.mjs
 *
 * AUTH: dashboard routes need a logged-in session. Create STORAGE_STATE once:
 *   npx playwright open --save-storage=vacantless-session.json http://localhost:3000/login
 *   (log in in the opened window, then close it). Pass that file via STORAGE_STATE.
 *   Omit STORAGE_STATE for public routes only.
 *
 * OUTPUT: ./mobile-qa-shots/<route-slug>__<breakpoint>.png  + a JSON summary on stdout.
 *
 * ENV OVERRIDES:
 *   BASE_URL       default http://localhost:3000
 *   ROUTES         comma-separated route list (defaults to the 7 ESL daily surfaces)
 *   OUT_DIR        default ./mobile-qa-shots
 *   STORAGE_STATE  Playwright storageState JSON for authenticated routes
 *   CHROMIUM_PATH  explicit chromium binary (else Playwright's bundled one)
 *   PW_PROXY       proxy server URL, if the run host needs one to reach BASE_URL
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = process.env.OUT_DIR || "./mobile-qa-shots";
const STORAGE = process.env.STORAGE_STATE || "";
const ROUTES = (process.env.ROUTES ||
  [
    "/dashboard",             // Today
    "/dashboard/properties",  // Rentals
    "/dashboard/leads",       // Renters
    "/dashboard/showings",    // Viewings
    "/dashboard/maintenance", // Repairs (Slice 9 repairs card inbox)
    "/dashboard/money",       // Money
    "/dashboard/settings",    // Settings IA
  ].join(",")
).split(",").map((s) => s.trim()).filter(Boolean);

const BREAKPOINTS = [
  { name: "390x844", w: 390, h: 844 },
  { name: "430x932", w: 430, h: 932 },
];
const EXEC = process.env.CHROMIUM_PATH || undefined;
const PROXY = process.env.PW_PROXY ? { server: process.env.PW_PROXY } : undefined;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC, proxy: PROXY });
const results = [];
for (const bp of BREAKPOINTS) {
  const ctx = await browser.newContext({
    viewport: { width: bp.w, height: bp.h },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    ...(STORAGE ? { storageState: STORAGE } : {}),
  });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const url = BASE.replace(/\/$/, "") + route;
    let status = "ERR";
    try {
      const r = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      status = r ? r.status() : "null";
    } catch (e) {
      status = "ERR:" + e.message.split("\n")[0];
    }
    await page.waitForTimeout(800);
    const slug = route.replace(/\//g, "_").replace(/^_/, "") || "root";
    const file = `${OUT}/${slug}__${bp.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const dims = await page.evaluate(() => ({ iw: innerWidth, dpr: devicePixelRatio }));
    results.push({ route, bp: bp.name, status, iw: dims.iw, file });
    await page.close();
  }
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
