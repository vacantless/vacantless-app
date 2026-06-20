// Unit tests for the pure virtual-tour helpers (lib/virtual-tour.ts).
// Run: npx tsx scripts/test-virtual-tour.ts
import {
  hostMatches,
  providerForHost,
  parseVirtualTour,
  normalizeVirtualTourUrl,
  virtualTourFor,
  virtualTourErrorMessage,
  TOUR_PROVIDERS,
} from "../lib/virtual-tour";

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

// --- hostMatches ------------------------------------------------------------
ok("hostMatches exact", hostMatches("youtube.com", "youtube.com"));
ok("hostMatches subdomain", hostMatches("www.youtube.com", "youtube.com"));
ok("hostMatches deep subdomain", hostMatches("m.youtube.com", "youtube.com"));
ok("hostMatches trailing dot", hostMatches("youtube.com.", "youtube.com"));
ok("hostMatches case-insensitive", hostMatches("YouTube.com", "youtube.com"));
ok(
  "hostMatches rejects suffix-trick",
  !hostMatches("evil-youtube.com", "youtube.com"),
);
ok(
  "hostMatches rejects lookalike domain",
  !hostMatches("youtube.com.evil.com", "youtube.com"),
);

// --- providerForHost --------------------------------------------------------
ok("provider youtube.com", providerForHost("youtube.com") === "youtube");
ok("provider youtu.be", providerForHost("youtu.be") === "youtube");
ok("provider www.youtube", providerForHost("www.youtube.com") === "youtube");
ok("provider vimeo", providerForHost("vimeo.com") === "vimeo");
ok("provider player.vimeo", providerForHost("player.vimeo.com") === "vimeo");
ok("provider iguide", providerForHost("youriguide.com") === "iguide");
ok(
  "provider iguide unbranded sub",
  providerForHost("unbranded.youriguide.com") === "iguide",
);
ok("provider matterport", providerForHost("matterport.com") === "matterport");
ok("provider my.matterport", providerForHost("my.matterport.com") === "matterport");
ok("provider unknown -> null", providerForHost("example.com") === null);
ok("provider empty -> null", providerForHost("") === null);
ok("provider null -> null", providerForHost(null) === null);
ok(
  "provider google maps NOT a tour host",
  providerForHost("maps.google.com") === null,
);

// --- parseVirtualTour: YouTube ----------------------------------------------
{
  const r = parseVirtualTour("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  ok("yt watch ok", r.ok === true);
  if (r.ok) {
    ok("yt provider", r.tour.provider === "youtube");
    ok(
      "yt embed reconstructed (nocookie)",
      r.tour.embedUrl === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    ok("yt href canonical", r.tour.href === "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  }
}
{
  const r = parseVirtualTour("https://youtu.be/dQw4w9WgXcQ");
  ok("youtu.be ok", r.ok === true && r.tour.embedUrl?.endsWith("/embed/dQw4w9WgXcQ") === true);
}
{
  const r = parseVirtualTour("https://www.youtube.com/shorts/dQw4w9WgXcQ");
  ok("yt shorts ok", r.ok === true && r.tour.embedUrl?.endsWith("/embed/dQw4w9WgXcQ") === true);
}
{
  const r = parseVirtualTour("https://www.youtube.com/embed/dQw4w9WgXcQ");
  ok("yt embed path ok", r.ok === true && r.tour.embedUrl?.endsWith("/embed/dQw4w9WgXcQ") === true);
}
{
  // host ok but no extractable id -> link only (embedUrl null), still ok.
  const r = parseVirtualTour("https://www.youtube.com/");
  ok("yt bare host link-only", r.ok === true && r.tour.embedUrl === null);
}

// --- parseVirtualTour: Vimeo ------------------------------------------------
{
  const r = parseVirtualTour("https://vimeo.com/123456789");
  ok("vimeo ok", r.ok === true);
  if (r.ok) {
    ok("vimeo embed", r.tour.embedUrl === "https://player.vimeo.com/video/123456789");
    ok("vimeo href", r.tour.href === "https://vimeo.com/123456789");
  }
}
{
  const r = parseVirtualTour("https://player.vimeo.com/video/123456789");
  ok("vimeo player url ok", r.ok === true && r.tour.embedUrl === "https://player.vimeo.com/video/123456789");
}

// --- parseVirtualTour: iGUIDE ----------------------------------------------
{
  const r = parseVirtualTour("https://youriguide.com/123_main_st_anytown_on/");
  ok("iguide ok", r.ok === true);
  if (r.ok) {
    ok("iguide provider", r.tour.provider === "iguide");
    ok(
      "iguide embed = canonical page",
      r.tour.embedUrl === "https://youriguide.com/123_main_st_anytown_on/",
    );
    ok("iguide label", r.tour.label === "iGUIDE tour");
  }
}
{
  // http -> upgraded to https in the canonical embed.
  const r = parseVirtualTour("http://youriguide.com/abc/");
  ok("iguide http upgraded to https", r.ok === true && r.tour.embedUrl === "https://youriguide.com/abc/");
}

// --- parseVirtualTour: Matterport ------------------------------------------
{
  const r = parseVirtualTour("https://my.matterport.com/show/?m=abc123XYZ");
  ok("matterport ok", r.ok === true);
  if (r.ok) {
    ok("matterport embed", r.tour.embedUrl === "https://my.matterport.com/show/?m=abc123XYZ");
  }
}
{
  const r = parseVirtualTour("https://matterport.com/discover/space/xyz");
  ok("matterport no m param -> link only", r.ok === true && r.tour.embedUrl === null);
}

// --- parseVirtualTour: rejections (the security floor) ----------------------
ok("reject empty", parseVirtualTour("")?.ok === false);
ok("reject whitespace", parseVirtualTour("   ")?.ok === false);
ok("reject null", parseVirtualTour(null)?.ok === false);
{
  const r = parseVirtualTour("not a url");
  ok("reject non-url", r.ok === false && r.reason === "invalid");
}
{
  const r = parseVirtualTour("javascript:alert(1)");
  ok("reject javascript: scheme", r.ok === false && (r.reason === "scheme" || r.reason === "invalid"));
}
{
  const r = parseVirtualTour("data:text/html,<script>alert(1)</script>");
  ok("reject data: scheme", r.ok === false);
}
{
  const r = parseVirtualTour("https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ");
  ok("reject embedded credentials", r.ok === false && r.reason === "credentials");
}
{
  const r = parseVirtualTour("https://evil.com/watch?v=dQw4w9WgXcQ");
  ok("reject non-allow-listed host", r.ok === false && r.reason === "host");
}
{
  // a host that merely CONTAINS an allow-listed name is not allow-listed.
  const r = parseVirtualTour("https://youtube.com.evil.com/x");
  ok("reject lookalike host", r.ok === false && r.reason === "host");
}
{
  // SECURITY: no allow-listed embed URL ever carries a non-https scheme.
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "http://youriguide.com/abc/",
    "https://my.matterport.com/show/?m=abc123XYZ",
  ]) {
    const r = parseVirtualTour(url);
    const embedSafe = !r.ok || r.tour.embedUrl == null || r.tour.embedUrl.startsWith("https://");
    const hrefSafe = !r.ok || r.tour.href.startsWith("https://");
    ok(`embed+href https-only for ${url}`, embedSafe && hrefSafe);
  }
}

// --- normalizeVirtualTourUrl / virtualTourFor -------------------------------
ok(
  "normalize valid -> canonical href",
  normalizeVirtualTourUrl("https://youtu.be/dQw4w9WgXcQ") ===
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
);
ok("normalize invalid -> null", normalizeVirtualTourUrl("https://evil.com/x") === null);
ok("normalize empty -> null", normalizeVirtualTourUrl("") === null);
ok("virtualTourFor valid", virtualTourFor("https://vimeo.com/123456789")?.provider === "vimeo");
ok("virtualTourFor invalid -> null", virtualTourFor("https://evil.com") === null);

// --- error copy -------------------------------------------------------------
ok("error copy host mentions hosts", /YouTube|Vimeo|iGUIDE|Matterport/.test(virtualTourErrorMessage("host")));
ok("error copy default", virtualTourErrorMessage("weird").length > 0);

// --- coverage: every provider is reachable ----------------------------------
ok("provider list non-empty", TOUR_PROVIDERS.length === 4);

// ----------------------------------------------------------------------------
console.log(`virtual-tour: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
