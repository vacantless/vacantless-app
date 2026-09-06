// Guard: the Link Portals screen must not promise a connection it cannot make.
// Run: npx tsx scripts/test-stage1-connect-copy-truth.ts
//
// S681. The "Log in" path for an account_login channel routes to
// /dashboard/settings?tab=distribution#channel-<key>, where the ONLY control is
// a self-declared account_status dropdown. There is no session capture anywhere
// in the app: lib/distribution-session-crypto.ts exists, but no route ingests a
// session. So the button said "SET UP YOUR KIJIJI ACCOUNT" and delivered a menu.
//
// A new landlord discovers that only after signing up, which is the fastest way
// to lose them. These assertions keep the copy honest.
import { readFileSync } from "fs";
import {
  DISTRIBUTION_CHANNELS,
  channelByKey,
} from "../lib/distribution-channels";
import { STAGE1_CONNECT_KIND_COPY, stage1ConnectHref } from "../lib/stage1-link-portals";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  x ${name}`);
  }
}

const en = JSON.parse(readFileSync("messages/en.json", "utf8"));
const fr = JSON.parse(readFileSync("messages/fr.json", "utf8"));

const enKindLogin: string = en.stage1.kindLogin;
const enButtonLogin: string = en.stage1.buttons.login;
const frKindLogin: string = fr.stage1.kindLogin;
const frButtonLogin: string = fr.stage1.buttons.login;

// --- the promise must be qualified -----------------------------------------
ok(
  "en kindLogin says Vacantless never logs in or posts for you",
  /never logs in/i.test(enKindLogin) && /posts for you/i.test(enKindLogin),
);
ok(
  "fr kindLogin carries the same disclaimer",
  /jamais/i.test(frKindLogin) && /publie/i.test(frKindLogin),
);

// --- the button must not claim setup or connection -------------------------
ok(
  "en login button does not claim to SET UP the account",
  !/set up/i.test(enButtonLogin),
);
ok(
  "en login button does not claim to CONNECT",
  !/connect/i.test(enButtonLogin),
);
ok(
  "fr login button does not claim to CONFIGURER",
  !/configurer/i.test(frButtonLogin),
);
ok("en login button keeps the {name} token", enButtonLogin.includes("{name}"));
ok("fr login button keeps the {name} token", frButtonLogin.includes("{name}"));

// --- only oauth may route to a real connect endpoint -----------------------
for (const channel of DISTRIBUTION_CHANNELS) {
  const href = stage1ConnectHref(channel.key, channel.connectKind);
  if (channel.connectKind === "account_login") {
    ok(
      `${channel.key}: account_login routes to settings, not a connect endpoint`,
      href !== null && href.startsWith("/dashboard/settings") && !href.includes("/api/"),
    );
  }
  if (channel.connectKind === "none") {
    ok(`${channel.key}: connectKind none offers no href`, href === null);
  }
}

// --- Facebook remains the only genuine self-serve connection ---------------
{
  const oauthChannels = DISTRIBUTION_CHANNELS.filter(
    (c) => c.connectKind === "oauth",
  ).map((c) => c.key);
  ok(
    "oauth is limited to the Meta channels that really have it",
    oauthChannels.every((k) => k === "facebook_feed" || k === "instagram"),
  );
  ok(
    "kijiji is NOT oauth",
    channelByKey("kijiji")?.connectKind === "account_login",
  );
}

// --- the copy map still covers every kind ----------------------------------
ok(
  "every connect kind maps to a copy key",
  (["account_login", "oauth", "none"] as const).every(
    (k) => typeof STAGE1_CONNECT_KIND_COPY[k] === "string",
  ),
);

console.log(`\nstage1-connect-copy-truth: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
