"use client";

// S748: shown when a page crashes. It reports the crash once (the daily health
// email counts them) and offers a way back. Plain words, no technical detail.
// S825c: a dropped connection (phone went to sleep, Safari "Load failed") is
// not a bug: the page tries again by itself once, and that is logged as
// "network", not as a crash. A second failure shows the normal page.
import { startTransition, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isNetworkErrorMessage } from "@/lib/app-errors";

const RETRY_KEY = "vl-net-retry";
const RETRY_WINDOW_MS = 30_000;

function shouldRetry(path: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(RETRY_KEY);
    const last = raw ? (JSON.parse(raw) as { path?: string; at?: number }) : null;
    if (last && last.path === path && typeof last.at === "number" && Date.now() - last.at < RETRY_WINDOW_MS) return false;
    window.sessionStorage.setItem(RETRY_KEY, JSON.stringify({ path, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    const network = isNetworkErrorMessage(error?.message) && shouldRetry(path);
    try {
      void fetch("/api/report-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path,
          digest: error?.digest ?? null,
          message: error?.message ?? null,
          kind: network ? "network" : "page",
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // nothing to do
    }
    if (network) {
      setRetrying(true);
      const t = window.setTimeout(() => {
        // Fetch the page again from the server, then clear the error.
        startTransition(() => {
          router.refresh();
          reset();
        });
      }, 800);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [error, reset, router]);

  if (retrying) {
    return (
      <main style={{ maxWidth: 520, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#555" }}>The connection dropped. Loading the page again...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 520, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong on this page.</h1>
      <p style={{ color: "#555", lineHeight: 1.5 }}>We have been told about it. Try again, or go back to where you were.</p>
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <button
          type="button"
          onClick={() => reset()}
          style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#0b7a4b", color: "#fff", cursor: "pointer" }}
        >
          Try again
        </button>
        <a href="/" style={{ padding: "10px 16px", color: "#0b7a4b" }}>
          Go to the home page
        </a>
      </div>
    </main>
  );
}
