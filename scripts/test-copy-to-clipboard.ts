// Unit tests for the pure clipboard-fallback logic. The DOM/execCommand path is
// exercised via injected deps so this runs under plain node/tsx (no jsdom).
// Run: npx tsx scripts/test-copy-to-clipboard.ts
import { copyToClipboard, legacyExecCopy } from "../lib/copy-to-clipboard";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

async function run() {
  // --- Clipboard API succeeds -> true, legacy never called -------------------
  {
    let wrote: string | null = null;
    let legacyCalled = false;
    const r = await copyToClipboard("hello", {
      writeText: async (t) => {
        wrote = t;
      },
      legacyCopy: () => {
        legacyCalled = true;
        return true;
      },
    });
    ok("api ok -> returns true", r === true);
    ok("api ok -> passes the exact text", wrote === "hello");
    ok("api ok -> legacy not attempted", legacyCalled === false);
  }

  // --- Clipboard API rejects -> falls back to legacy -------------------------
  {
    let legacyText: string | null = null;
    const r = await copyToClipboard("world", {
      writeText: async () => {
        throw new Error("blocked");
      },
      legacyCopy: (t) => {
        legacyText = t;
        return true;
      },
    });
    ok("api throws + legacy ok -> true", r === true);
    ok("legacy receives the same text", legacyText === "world");
  }

  // --- Clipboard API rejects AND legacy fails -> false -----------------------
  {
    const r = await copyToClipboard("x", {
      writeText: async () => {
        throw new Error("blocked");
      },
      legacyCopy: () => false,
    });
    ok("both fail -> returns false", r === false);
  }

  // --- No Clipboard API available -> legacy path -----------------------------
  {
    let legacyText: string | null = null;
    const r = await copyToClipboard("y", {
      writeText: undefined,
      legacyCopy: (t) => {
        legacyText = t;
        return true;
      },
    });
    ok("no api -> uses legacy", legacyText === "y" && r === true);
  }

  // --- Legacy that throws is caught -> false ---------------------------------
  {
    const r = await copyToClipboard("z", {
      writeText: undefined,
      legacyCopy: () => {
        throw new Error("execCommand exploded");
      },
    });
    ok("legacy throws -> caught, returns false", r === false);
  }

  // --- legacyExecCopy is SSR-safe (no document in node) -> false -------------
  ok("legacyExecCopy: no document -> false", legacyExecCopy("anything") === false);

  // --- Default path in node (no navigator, no document) -> false -------------
  {
    const r = await copyToClipboard("no-env");
    ok("default deps in node -> false (no api, no document)", r === false);
  }

  console.log(`\ncopy-to-clipboard: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();
