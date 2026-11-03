"use client";

// S748: shown when a page crashes. It reports the crash once (the daily health
// email counts them) and offers a way back. Plain words, no technical detail.
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      void fetch("/api/report-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: window.location.pathname,
          digest: error?.digest ?? null,
          message: error?.message ?? null,
          kind: "page",
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // nothing to do
    }
  }, [error]);

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
