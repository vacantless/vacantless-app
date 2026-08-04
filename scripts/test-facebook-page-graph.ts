// Unit tests for Facebook Page Graph posting helpers (S622).
// Run: npx tsx scripts/test-facebook-page-graph.ts
import { readFileSync } from "fs";
import {
  buildPageFeedMessage,
  classifyFacebookGraphError,
  facebookPagePermalink,
} from "../lib/facebook-page-graph";
import {
  decryptSessionState,
  encryptSessionState,
} from "../lib/distribution-session-crypto";

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// --- message builder -------------------------------------------------------
{
  const message = buildPageFeedMessage({
    address: "  12 Example St, Unit 3  ",
    beds: 2,
    baths: 1.5,
    rentCents: 245000,
    publicUrl: "https://app.test/r/prop1?p=post1",
  });
  ok("message includes address", message.includes("For rent: 12 Example St, Unit 3"));
  ok("message includes beds and baths", message.includes("2 beds, 1.5 baths"));
  ok("message includes rent", message.includes("$2,450/mo"));
  ok("message includes tracked public URL", message.includes("https://app.test/r/prop1?p=post1"));
  ok("message has no em dash", !/[—–]/.test(message));
}
{
  const message = buildPageFeedMessage({
    address: null,
    beds: null,
    baths: null,
    rentCents: 0,
    publicUrl: "https://app.test/r/prop2",
  });
  ok("message has safe fallback headline", message.startsWith("Rental listing now available"));
  ok("message omits zero rent", !message.includes("$0"));
}

// --- permalink -------------------------------------------------------------
ok(
  "composite Graph id permalink is deterministic",
  facebookPagePermalink("123", "123_456") === "https://www.facebook.com/123_456",
);
ok(
  "bare Graph post id is paired with page id",
  facebookPagePermalink("123", "456") === "https://www.facebook.com/123_456",
);

// --- error classification --------------------------------------------------
{
  const classified = classifyFacebookGraphError({
    error: {
      message: "Session has expired",
      type: "OAuthException",
      code: 190,
      error_subcode: 463,
    },
  });
  ok("OAuthException is auth error", classified.isAuthError);
  ok("OAuth code is retained", classified.code === 190);
}
{
  const classified = classifyFacebookGraphError({
    error: {
      message: "Rate limited",
      type: "GraphMethodException",
      code: 4,
    },
  });
  ok("non-auth Graph error is not reconnect", !classified.isAuthError);
  ok("non-auth message is retained", classified.error === "Rate limited");
}

// --- session envelope ------------------------------------------------------
{
  const key = Buffer.alloc(32, 7);
  const payload = JSON.stringify({
    page_id: "123",
    page_access_token: "token",
  });
  const envelope = encryptSessionState(payload, key);
  const decrypted = decryptSessionState(envelope, key);
  ok("session encrypt/decrypt round-trips", decrypted === payload);
  const tampered = {
    ...envelope,
    ciphertext: Buffer.from(envelope.ciphertext),
  };
  tampered.ciphertext[0] = tampered.ciphertext[0] ^ 1;
  let threw = false;
  try {
    decryptSessionState(tampered, key);
  } catch {
    threw = true;
  }
  ok("session decrypt rejects tampering", threw);
}

// --- source guardrails -----------------------------------------------------
{
  const actionSource = readFileSync(
    "app/dashboard/properties/distribution-actions.ts",
    "utf8",
  );
  ok(
    "Facebook Page proof uses existing operator actor",
    /actorType:\s*"operator"/.test(actionSource),
  );
  ok(
    "Graph nature is recorded in metadata",
    /via:\s*"graph_api_page"/.test(actionSource) &&
      /post_id:\s*graph\.postId/.test(actionSource),
  );
  ok(
    "listing_posts uses facebook_feed portal",
    actionSource.includes("normalizePortal(FACEBOOK_FEED_CHANNEL)"),
  );
}

console.log(`facebook-page-graph: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
