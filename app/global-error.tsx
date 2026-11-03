"use client";

// S748: shown when the whole app shell crashes (app/error.tsx cannot catch an
// error in the root layout). Same report, same plain words.
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      void fetch("/api/report-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: window.location.pathname,
          digest: error?.digest ?? null,
          message: error?.message ?? null,
          kind: "global",
        }),
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // nothing to do
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ maxWidth: 520, margin: "64px auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong.</h1>
          <p style={{ color: "#555", lineHeight: 1.5 }}>We have been told about it. Please try again.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: 20, padding: "10px 16px", borderRadius: 8, border: 0, background: "#0b7a4b", color: "#fff", cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
