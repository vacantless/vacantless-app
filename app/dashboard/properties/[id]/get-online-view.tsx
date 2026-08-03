"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

const MODE_KEY = "vacantless.getonline.mode";

type Mode = "simple" | "advanced";

export function GetOnlineView({
  simple,
  advanced,
  orgDefaultMode,
}: {
  simple: ReactNode;
  advanced: ReactNode;
  orgDefaultMode?: Mode | null;
}) {
  const [mode, setMode] = useState<Mode>(
    orgDefaultMode === "advanced" ? "advanced" : "simple",
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(MODE_KEY);
    if (saved === "advanced") setMode("advanced");
    else if (saved === "simple") setMode("simple");
  }, []);

  function setAndStore(next: Mode) {
    setMode(next);
    window.localStorage.setItem(MODE_KEY, next);
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {mode === "advanced" ? (
          <button
            type="button"
            onClick={() => setAndStore("simple")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            &larr; Simple view
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setAndStore("advanced")}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            Advanced tools &rarr;
          </button>
        )}
      </div>
      {mode === "advanced" ? advanced : simple}
    </div>
  );
}
