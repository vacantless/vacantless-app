#!/usr/bin/env node
// S742h: one command that runs every scripts/test-*.ts and reports.
//   node scripts/run-all-tests.mjs            run everything
//   node scripts/run-all-tests.mjs --shard 1/4   one quarter (CI matrix)
//   node scripts/run-all-tests.mjs --list     print the file list
// A test that needs the database or a live service lists itself in
// scripts/tests-needing-services.txt and is skipped here (it still runs by
// hand). A test in scripts/tests-known-red.txt may fail without failing the
// run; that file is meant to shrink, never grow.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();
const dir = join(root, "scripts");
const readList = (name) =>
  existsSync(join(dir, name))
    ? readFileSync(join(dir, name), "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];
const needsServices = new Set(readList("tests-needing-services.txt"));
const knownRed = new Set(readList("tests-known-red.txt"));

let files = readdirSync(dir).filter((f) => /^test-.*\.ts$/.test(f)).sort();
const args = process.argv.slice(2);
if (args.includes("--list")) {
  console.log(files.join("\n"));
  process.exit(0);
}
const shardArg = args[args.indexOf("--shard") + 1];
if (args.includes("--shard") && /^\d+\/\d+$/.test(shardArg ?? "")) {
  const [i, n] = shardArg.split("/").map(Number);
  files = files.filter((_, idx) => idx % n === i - 1);
}
const timeoutMs = Number(process.env.TEST_TIMEOUT_MS || 120000);

const results = { passed: [], failed: [], knownRed: [], skipped: [] };
const started = Date.now();
for (const f of files) {
  if (needsServices.has(f)) {
    results.skipped.push(f);
    continue;
  }
  const t0 = Date.now();
  const r = spawnSync("npx", ["tsx", join("scripts", f)], {
    cwd: root,
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ms = Date.now() - t0;
  const ok = r.status === 0 && !r.error;
  if (ok) {
    results.passed.push(f);
    process.stdout.write(`ok    ${f} (${ms} ms)\n`);
  } else if (knownRed.has(f)) {
    results.knownRed.push(f);
    process.stdout.write(`red*  ${f} (known, ${ms} ms)\n`);
  } else {
    results.failed.push(f);
    const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n      ");
    process.stdout.write(`FAIL  ${f} (${ms} ms)${r.error ? ` ${r.error.message}` : ""}\n      ${tail}\n`);
  }
}
const secs = Math.round((Date.now() - started) / 1000);
console.log(
  `\n${results.passed.length} passed, ${results.failed.length} failed, ${results.knownRed.length} known red, ${results.skipped.length} need services, in ${secs} s`,
);
if (results.failed.length > 0) {
  console.log("Failed:\n  " + results.failed.join("\n  "));
  process.exit(1);
}
